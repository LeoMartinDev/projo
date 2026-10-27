import { appError, type AppError, err, ok, type Result } from '@projo/shared'
import { maxImageUploadBytes } from '@projo/shared/api/metadata'

import type { Clock } from '../../core/clock.ts'
import type { EventBus } from '../../core/events.ts'
import type { IdGenerator } from '../../core/ids.ts'
import type { JobQueue } from '../../core/jobs/ports.ts'
import type { LibraryRepository } from '../../core/library/library.ts'
import type { Logger } from '../../core/logger.ts'
import {
  type EditableField,
  type EditableImageKind,
  type EditableItem,
  type ImageAlternative,
  type ImageReencoder,
  type ItemOverrideRepository,
  type ItemOverrides,
  lockableFieldOf,
} from '../../core/metadata/editing.ts'
import { type ItemMetadata, sizedDimensions } from '../../core/metadata/enrichment.ts'
import { detectImageType } from '../../core/metadata/image-type.ts'
import type {
  ImageFiles,
  ImageRepository,
  MetadataItemRepository,
  MetadataSettings,
} from '../../core/metadata/ports.ts'
import type { TmdbApi, TmdbError, TmdbImagesTarget } from '../../core/metadata/tmdb.ts'
import type { MetadataEditing, ItemMetadataView, SetItemImageError } from './editing-types.ts'
import type { FetchImages } from './fetch-images.ts'
import {
  LIBRARY_REFRESH_PRIORITY,
  libraryRefreshDedupeKey,
  refreshDedupeKey,
  type RefreshMetadata,
} from './refresh-metadata.ts'

type Deps = {
  overrides: ItemOverrideRepository
  items: Pick<MetadataItemRepository, 'imageContext'>
  images: ImageRepository
  files: ImageFiles
  /** WebP variants of a written image (§9.1). */
  encodeVariants: (localPath: string) => Promise<void>
  tmdb: Pick<TmdbApi, 'images' | 'downloadImage'>
  refresh: Pick<RefreshMetadata, 'currentMetadata'>
  fetchImages: FetchImages
  reencoder: ImageReencoder
  libraryRepository: Pick<LibraryRepository, 'findById'>
  settings: Pick<MetadataSettings, 'language'>
  jobQueue: JobQueue
  eventBus: EventBus
  ids: IdGenerator
  clock: Clock
  logger: Logger
}

/** Order of `locked` in the views. */
const editableFields: readonly EditableField[] = [
  'title',
  'year',
  'overview',
  'genres',
  'poster',
  'backdrop',
]

const overrideKeyOf = {
  title: 'title',
  year: 'year',
  overview: 'overview',
  genres: 'genres',
  poster: 'posterImageId',
  backdrop: 'backdropImageId',
} as const satisfies Record<EditableField, keyof ItemOverrides>

/** §9.1 sizes: what a chosen TMDB image is downloaded at. */
const downloadSize = { poster: 'w500', backdrop: 'w1280' } as const
const folderOf = { poster: 'posters', backdrop: 'backdrops' } as const
/** At most this many alternatives in the editor's grid. */
const MAX_ALTERNATIVES = 60

const extensionOf = (contentType: string, path: string): string => {
  if (contentType.includes('png')) return 'png'
  if (contentType.includes('webp')) return 'webp'
  if (contentType.includes('jpeg') || contentType.includes('jpg')) return 'jpg'
  return /\.([a-z0-9]{2,4})$/iu.exec(path)?.[1]?.toLowerCase() ?? 'jpg'
}

/** The TMDB value of a text field, written back by "Back to the TMDB value" (undefined clears it). */
const restoredOf = (field: 'title' | 'year' | 'overview' | 'genres', metadata: ItemMetadata) => {
  switch (field) {
    case 'title':
      return { title: metadata.title }
    case 'year':
      return { year: metadata.year }
    case 'overview':
      return { overview: metadata.overview }
    case 'genres':
      return { genres: metadata.genres }
  }
}

const notFound = (itemId: string) =>
  err(appError('item/not_found', 'item not found', { context: { id: itemId } }))
const notMatched = (itemId: string) =>
  err(
    appError('metadata/not_matched', 'the item is not identified on TMDB', {
      context: { id: itemId },
    }),
  )

/**
 * Metadata editing (§9.3) and the refresh requests (§9.4) of the admin: values and locks, TMDB
 * image alternatives, chosen or uploaded images (re-encoded by ffmpeg, §20), "Back to the TMDB value".
 * Every change is published as `catalog.changed`: titles and posters change for every profile.
 */
export const metadataEditingFactory = ({
  overrides,
  items,
  images,
  files,
  encodeVariants,
  tmdb,
  refresh,
  fetchImages,
  reencoder,
  libraryRepository,
  settings,
  jobQueue,
  eventBus,
  ids,
  clock,
  logger,
}: Deps): MetadataEditing => {
  const viewOf = (item: EditableItem): ItemMetadataView => {
    const locked = overrides.get(item.id)
    return {
      ...item,
      locked: editableFields.filter((field) => locked[overrideKeyOf[field]] !== undefined),
    }
  }

  const view = (itemId: string) => {
    const item = overrides.item(itemId)
    return item === undefined ? notFound(itemId) : ok(viewOf(item))
  }

  const changed = () => eventBus.publish('catalog.changed', {})

  /** Whose `/images` hold the alternatives of a slot (§9.3; seasons: series backdrops). */
  const targetOf = (
    itemId: string,
    kind: EditableImageKind,
  ): { target: TmdbImagesTarget; language: string } | undefined => {
    const context = items.imageContext(itemId)
    if (context?.tmdbId === undefined) return undefined
    const language = context.libraryLanguage ?? settings.language()
    switch (context.kind) {
      case 'movie':
        return { target: { kind: 'movie', tmdbId: context.tmdbId }, language }
      case 'series':
        return { target: { kind: 'series', tmdbId: context.tmdbId }, language }
      case 'season':
      case 'episode': {
        if (context.seriesTmdbId === undefined) return undefined
        if (context.kind === 'season' && kind === 'poster' && context.seasonNumber !== undefined) {
          return {
            target: {
              kind: 'season',
              seriesTmdbId: context.seriesTmdbId,
              seasonNumber: context.seasonNumber,
            },
            language,
          }
        }
        return { target: { kind: 'series', tmdbId: context.seriesTmdbId }, language }
      }
    }
  }

  const alternativesOf = async (
    itemId: string,
    kind: EditableImageKind,
  ): Promise<Result<ImageAlternative[], TmdbError | AppError<'metadata/not_matched'>>> => {
    const target = targetOf(itemId, kind)
    if (target === undefined) return notMatched(itemId)
    const found = await tmdb.images(target)
    if (!found.ok) return found
    const list = kind === 'poster' ? found.value.posters : found.value.backdrops
    return ok(
      [...list]
        .sort((a, b) => b.voteAverage - a.voteAverage || b.width - a.width)
        .slice(0, MAX_ALTERNATIVES)
        .map((image) => ({
          tmdbPath: image.path,
          width: image.width,
          height: image.height,
          voteAverage: image.voteAverage,
          ...(image.language === undefined ? {} : { language: image.language }),
        })),
    )
  }

  /** Puts a stored image in the slot (locked) and forgets the one it replaces. */
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
    if (targetOf(itemId, kind) === undefined) return notMatched(itemId)
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

  return {
    get: ({ itemId }) => view(itemId),

    setOverrides: ({ itemId, overrides: values }) => {
      if (overrides.item(itemId) === undefined) return notFound(itemId)
      overrides.set({ itemId, overrides: values, at: clock.now() })
      logger.info('item metadata edited', { itemId, fields: Object.keys(values) })
      changed()
      return view(itemId)
    },

    removeOverride: async ({ itemId, field }) => {
      const item = overrides.item(itemId)
      if (item === undefined) return notFound(itemId)
      const lockable = lockableFieldOf[field]
      if (field === 'poster' || field === 'backdrop') {
        overrides.remove({ itemId, field: lockable, at: clock.now() })
        // TMDB's choice comes back at once (stored details, one download).
        if (item.tmdbId !== undefined) {
          const fetched = await fetchImages({ itemId })
          if (!fetched.ok) {
            logger.warn('TMDB image not restored', { itemId, field, code: fetched.error.code })
          }
        }
      } else {
        const current = await refresh.currentMetadata(itemId)
        if (!current.ok) {
          logger.info('TMDB value not restored', { itemId, field, code: current.error.code })
        }
        const metadata = current.ok ? current.value : undefined
        overrides.remove({
          itemId,
          field: lockable,
          ...(metadata === undefined ? {} : { restored: restoredOf(field, metadata) }),
          at: clock.now(),
        })
      }
      logger.info('item lock removed', { itemId, field })
      changed()
      return view(itemId)
    },

    alternatives: async ({ itemId, kind }) => {
      if (overrides.item(itemId) === undefined) return notFound(itemId)
      const found = await alternativesOf(itemId, kind)
      if (!found.ok) return found
      const current = images.itemImage({ itemId, slot: kind })?.tmdbPath
      return ok(found.value.map((image) => ({ ...image, current: image.tmdbPath === current })))
    },

    setImage: async ({ itemId, choice }) => {
      if (overrides.item(itemId) === undefined) return notFound(itemId)
      const result =
        'tmdbPath' in choice
          ? await chooseTmdbImage(itemId, choice.kind, choice.tmdbPath)
          : await uploadImage(itemId, choice.kind, choice.upload)
      if (!result.ok) return result
      changed()
      return view(itemId)
    },

    requestRefresh: ({ itemId }) => {
      const item = overrides.item(itemId)
      if (item === undefined) return notFound(itemId)
      if (item.tmdbId === undefined) return notMatched(itemId)
      const { job } = jobQueue.enqueue({
        type: 'refresh_metadata',
        payload: { itemId },
        dedupeKey: refreshDedupeKey(itemId),
      })
      return ok(job)
    },

    requestLibraryRefresh: ({ libraryId }) => {
      if (libraryRepository.findById(libraryId) === undefined) {
        return err(appError('library/not_found', 'library not found', { context: { libraryId } }))
      }
      const { job } = jobQueue.enqueue({
        type: 'refresh_metadata',
        payload: { libraryId },
        dedupeKey: libraryRefreshDedupeKey(libraryId),
        priority: LIBRARY_REFRESH_PRIORITY,
      })
      return ok(job)
    },
  }
}
