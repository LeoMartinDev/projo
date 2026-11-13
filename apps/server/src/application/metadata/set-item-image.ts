import { appError, type AppError, err, ok, type Result } from '@projo/shared'
import { maxImageUploadBytes } from '@projo/shared/api/metadata'

import type { Clock } from '../../core/clock.ts'
import type { EventBus } from '../../core/events.ts'
import type { IdGenerator } from '../../core/ids.ts'
import type { Logger } from '../../core/logger.ts'
import type {
  EditableImageKind,
  ImageReencoder,
  ImageUploadError,
  ItemOverrideRepository,
} from '../../core/metadata/editing.ts'
import { sizedDimensions } from '../../core/metadata/enrichment.ts'
import { detectImageType } from '../../core/metadata/image-type.ts'
import type {
  ImageFiles,
  ImageRepository,
  MetadataItemRepository,
  MetadataSettings,
} from '../../core/metadata/ports.ts'
import type { TmdbApi, TmdbError } from '../../core/metadata/tmdb.ts'
import type { EncodeVariants } from './shared/encode-variants.ts'
import {
  tmdbImageAlternativesFactory,
  tmdbImageTargetFactory,
} from './shared/image-alternatives.ts'
import { itemNotFound, itemNotMatched } from './shared/item-errors.ts'
import { type ItemMetadataView, itemMetadataViewFactory } from './shared/item-metadata-view.ts'

type Deps = {
  overrides: Pick<ItemOverrideRepository, 'item' | 'get' | 'set'>
  items: Pick<MetadataItemRepository, 'imageContext'>
  images: Pick<ImageRepository, 'itemImage' | 'insert' | 'deleteIfUnused'>
  files: Pick<ImageFiles, 'write' | 'remove'>
  encodeVariants: EncodeVariants
  tmdb: Pick<TmdbApi, 'images' | 'downloadImage'>
  reencoder: ImageReencoder
  settings: Pick<MetadataSettings, 'language'>
  eventBus: EventBus
  ids: IdGenerator
  clock: Clock
  logger: Logger
}

export type ImageChoice =
  | { kind: EditableImageKind; tmdbPath: string }
  | { kind: EditableImageKind; upload: { bytes: Uint8Array; sizeBytes: number } }

export type SetItemImageError =
  | AppError<'item/not_found'>
  | ImageUploadError
  | TmdbError
  | AppError<
      'metadata/not_matched' | 'metadata/image_failed' | 'media/binary_missing' | 'media/timeout'
    >

const downloadSize = { poster: 'w500', backdrop: 'w1280' } as const
const folderOf = { poster: 'posters', backdrop: 'backdrops' } as const

const extensionOf = (contentType: string, path: string): string => {
  if (contentType.includes('png')) return 'png'
  if (contentType.includes('webp')) return 'webp'
  if (contentType.includes('jpeg') || contentType.includes('jpg')) return 'jpg'
  return /\.([a-z0-9]{2,4})$/iu.exec(path)?.[1]?.toLowerCase() ?? 'jpg'
}

/** A TMDB alternative or an uploaded file becomes the item's poster or backdrop, locked (§9.3). */
export const setItemImageFactory = ({
  overrides,
  items,
  images,
  files,
  encodeVariants,
  tmdb,
  reencoder,
  settings,
  eventBus,
  ids,
  clock,
  logger,
}: Deps) => {
  const view = itemMetadataViewFactory({ overrides })
  const targetOf = tmdbImageTargetFactory({ items, settings })
  const alternativesOf = tmdbImageAlternativesFactory({ items, settings, tmdb })

  const useImage = async (itemId: string, kind: EditableImageKind, imageId: string) => {
    const previous = images.itemImage({ itemId, slot: kind })
    overrides.set({
      itemId,
      overrides: kind === 'poster' ? { posterImageId: imageId } : { backdropImageId: imageId },
      at: clock.now(),
    })
    if (previous !== undefined && previous.imageId !== imageId) {
      const removed = images.deleteIfUnused(previous.imageId)
      if (removed !== undefined) await files.remove(removed.localPath)
    }
  }

  const chooseTmdbImage = async (
    itemId: string,
    kind: EditableImageKind,
    tmdbPath: string,
  ): Promise<Result<void, SetItemImageError>> => {
    if (targetOf(itemId, kind) === undefined) return itemNotMatched(itemId)
    const size = downloadSize[kind]
    const known = await alternativesOf(itemId, kind)
    const original = known.ok ? known.value.find((image) => image.tmdbPath === tmdbPath) : undefined
    const fetched = await tmdb.downloadImage({ path: tmdbPath, size })
    if (!fetched.ok) return fetched
    const id = ids.next()
    const localPath = `${folderOf[kind]}/${id}.${extensionOf(fetched.value.contentType, tmdbPath)}`
    const written = await files.write({ relativePath: localPath, bytes: fetched.value.bytes })
    if (!written.ok) return written
    await encodeVariants(localPath)
    images.insert({
      id,
      kind,
      origin: 'tmdb',
      tmdbPath,
      localPath,
      ...sizedDimensions(size, kind, original),
      ...(original?.language === undefined ? {} : { language: original.language }),
    })
    await useImage(itemId, kind, id)
    logger.info('item image chosen', { itemId, kind, tmdbPath })
    return ok()
  }

  const uploadImage = async (
    itemId: string,
    kind: EditableImageKind,
    upload: { bytes: Uint8Array; sizeBytes: number },
  ): Promise<Result<void, SetItemImageError>> => {
    const sizeBytes = Math.max(upload.sizeBytes, upload.bytes.byteLength)
    if (sizeBytes > maxImageUploadBytes) {
      return err(
        appError('image/too_large', 'uploaded image too large', {
          context: { sizeBytes, maxBytes: maxImageUploadBytes },
        }),
      )
    }
    const type = detectImageType(upload.bytes)
    if (type === undefined) {
      return err(appError('image/unsupported_type', 'only JPEG, PNG and WebP images are accepted'))
    }
    const encoded = await reencoder.reencode({ bytes: upload.bytes, type, kind })
    if (!encoded.ok) return encoded
    const id = ids.next()
    const localPath = `custom/${id}.${encoded.value.extension}`
    const written = await files.write({ relativePath: localPath, bytes: encoded.value.bytes })
    if (!written.ok) return written
    await encodeVariants(localPath)
    images.insert({
      id,
      kind,
      origin: 'custom',
      localPath,
      width: encoded.value.width,
      height: encoded.value.height,
    })
    await useImage(itemId, kind, id)
    logger.info('item image uploaded', { itemId, kind, sizeBytes })
    return ok()
  }

  return async ({
    itemId,
    choice,
  }: {
    itemId: string
    choice: ImageChoice
  }): Promise<Result<ItemMetadataView, SetItemImageError>> => {
    if (overrides.item(itemId) === undefined) return itemNotFound(itemId)
    const result =
      'tmdbPath' in choice
        ? await chooseTmdbImage(itemId, choice.kind, choice.tmdbPath)
        : await uploadImage(itemId, choice.kind, choice.upload)
    if (!result.ok) return result
    eventBus.publish('catalog.changed', {})
    return view(itemId)
  }
}

export type SetItemImage = ReturnType<typeof setItemImageFactory>
