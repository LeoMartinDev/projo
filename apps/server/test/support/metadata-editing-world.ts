import { appError, err, ok } from '@projo/shared'

import type { FetchImages } from '../../src/application/metadata/fetch-images.ts'
import { getItemMetadataFactory } from '../../src/application/metadata/get-item-metadata.ts'
import { listImageAlternativesFactory } from '../../src/application/metadata/list-image-alternatives.ts'
import type { LoadCurrentMetadata } from '../../src/application/metadata/load-current-metadata.ts'
import { removeItemOverrideFactory } from '../../src/application/metadata/remove-item-override.ts'
import { requestItemRefreshFactory } from '../../src/application/metadata/request-item-refresh.ts'
import { requestLibraryRefreshFactory } from '../../src/application/metadata/request-library-refresh.ts'
import { setItemImageFactory } from '../../src/application/metadata/set-item-image.ts'
import { setItemOverridesFactory } from '../../src/application/metadata/set-item-overrides.ts'
import type { Library } from '../../src/core/library/library.ts'
import type {
  EditableItem,
  ImageReencoder,
  ItemOverrideRepository,
  ItemOverrides,
} from '../../src/core/metadata/editing.ts'
import type { LockableField } from '../../src/core/metadata/enrichment.ts'
import type {
  ImageFiles,
  ImageRepository,
  ItemImageContext,
  StoredImage,
} from '../../src/core/metadata/ports.ts'
import type { TmdbApi, TmdbImage } from '../../src/core/metadata/tmdb.ts'
import { createManualClock } from './clock.ts'
import { createRecordingEventBus, createRecordingJobQueue, createSequentialIds } from './fakes.ts'
import { createCapturingLogger } from './logger.ts'
import { createFakeTmdb } from './metadata-fakes.ts'

/** Fixtures and fakes of the metadata editing use cases (§9.3–9.4). */

export const now = new Date('2026-05-01T12:00:00.000Z')

export const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0])
export const NOT_AN_IMAGE = new Uint8Array([1, 2, 3, 4])

const overrideKeyOf: Record<LockableField, keyof ItemOverrides> = {
  title: 'title',
  year: 'year',
  overview: 'overview',
  genres: 'genres',
  poster_image_id: 'posterImageId',
  backdrop_image_id: 'backdropImageId',
}

export const movieItem: EditableItem = {
  id: 'movie',
  kind: 'movie',
  tmdbId: 27205,
  title: 'Inception',
  year: 2010,
  genres: ['action'],
}
export const localItem: EditableItem = {
  id: 'local',
  kind: 'movie',
  title: 'Home video',
  genres: [],
}

export const poster = (path: string, overrides: Partial<TmdbImage> = {}): TmdbImage => ({
  path,
  width: 1000,
  height: 1500,
  voteAverage: 5,
  ...overrides,
})

export const storedImage = (id: string, overrides: Partial<StoredImage> = {}): StoredImage => ({
  id,
  kind: 'poster',
  origin: 'tmdb',
  localPath: `posters/${id}.jpg`,
  width: 500,
  height: 750,
  ...overrides,
})

type Options = {
  items?: EditableItem[]
  contexts?: ItemImageContext[]
  tmdb?: Partial<TmdbApi>
  /** Image shown in each slot, keyed `<itemId>:<slot>` (the items' `*_image_id` columns). */
  slots?: Record<string, string>
  storedImages?: StoredImage[]
  /** Images used as people's profile pictures. */
  profileImages?: string[]
  storedOverrides?: Record<string, ItemOverrides>
  currentMetadata?: LoadCurrentMetadata
  fetchImages?: FetchImages
  reencoder?: ImageReencoder
  writeFails?: boolean
  libraries?: Library[]
}

export const createEditingWorld = ({
  items = [movieItem, localItem],
  contexts = [{ id: 'movie', kind: 'movie', tmdbId: 27205 }],
  tmdb: tmdbOverrides = {},
  slots: initialSlots = {},
  storedImages = [],
  profileImages = [],
  storedOverrides = {},
  currentMetadata = async () => ok(undefined),
  fetchImages = async () => ok({ downloaded: 1 }),
  reencoder = {
    reencode: async () =>
      ok({ bytes: new Uint8Array([9]), extension: 'webp', width: 600, height: 900 }),
  },
  writeFails = false,
  libraries = [],
}: Options = {}) => {
  const rows = new Map(items.map((item) => [item.id, item]))
  const stored = new Map(Object.entries(storedOverrides))
  const slots = new Map(Object.entries(initialSlots))
  const overridesSet: Parameters<ItemOverrideRepository['set']>[0][] = []
  const overridesRemoved: Parameters<ItemOverrideRepository['remove']>[0][] = []
  const overrides: ItemOverrideRepository = {
    item: (itemId) => rows.get(itemId),
    get: (itemId) => stored.get(itemId) ?? {},
    set: (input) => {
      overridesSet.push(input)
      stored.set(input.itemId, { ...stored.get(input.itemId), ...input.overrides })
      const { posterImageId, backdropImageId } = input.overrides
      if (posterImageId !== undefined) slots.set(`${input.itemId}:poster`, posterImageId)
      if (backdropImageId !== undefined) slots.set(`${input.itemId}:backdrop`, backdropImageId)
    },
    remove: (input) => {
      overridesRemoved.push(input)
      const next = { ...stored.get(input.itemId) }
      delete next[overrideKeyOf[input.field]]
      stored.set(input.itemId, next)
    },
  }
  const images = new Map(storedImages.map((image) => [image.id, image]))
  const referenced = (id: string) =>
    [...slots.values()].includes(id) ||
    profileImages.includes(id) ||
    [...stored.values()].some(
      (values) => values.posterImageId === id || values.backdropImageId === id,
    )
  const inserted: StoredImage[] = []
  const deleteAsked: string[] = []
  const written: string[] = []
  const removedFiles: string[] = []
  const encoded: string[] = []
  const fetchedFor: string[] = []
  const fake = createFakeTmdb(tmdbOverrides)
  const events = createRecordingEventBus()
  const jobs = createRecordingJobQueue()
  const { logger, lines } = createCapturingLogger()
  const imageRepository: ImageRepository = {
    findById: (id) => images.get(id),
    itemImage: ({ itemId, slot }) => {
      const imageId = slots.get(`${itemId}:${slot}`)
      const image = imageId === undefined ? undefined : images.get(imageId)
      return image === undefined
        ? undefined
        : {
            imageId: image.id,
            origin: image.origin,
            ...(image.tmdbPath === undefined ? {} : { tmdbPath: image.tmdbPath }),
          }
    },
    insert: (image) => {
      inserted.push(image)
      images.set(image.id, image)
    },
    setItemImage: () => {},
    setPersonImage: () => {},
    localPaths: () => [],
    deleteIfUnused: (id) => {
      deleteAsked.push(id)
      if (referenced(id)) return undefined
      const image = images.get(id)
      images.delete(id)
      return image
    },
    listUnused: () => [],
  }
  const imageFiles: ImageFiles = {
    write: async ({ relativePath }) => {
      if (writeFails) return err(appError('metadata/image_failed', 'disk full'))
      written.push(relativePath)
      return ok()
    },
    remove: async (relativePath) => void removedFiles.push(relativePath),
    absolutePath: (relativePath) => `/data/images/${relativePath}`,
  }
  const deps: Parameters<typeof getItemMetadataFactory>[0] &
    Parameters<typeof setItemOverridesFactory>[0] &
    Parameters<typeof removeItemOverrideFactory>[0] &
    Parameters<typeof listImageAlternativesFactory>[0] &
    Parameters<typeof setItemImageFactory>[0] &
    Parameters<typeof requestItemRefreshFactory>[0] &
    Parameters<typeof requestLibraryRefreshFactory>[0] = {
    overrides,
    items: { imageContext: (itemId) => contexts.find((context) => context.id === itemId) },
    images: imageRepository,
    files: imageFiles,
    encodeVariants: async (localPath) => void encoded.push(localPath),
    tmdb: fake.tmdb,
    loadCurrentMetadata: currentMetadata,
    fetchImages: async (input) => {
      fetchedFor.push(input.itemId)
      return fetchImages(input)
    },
    reencoder,
    libraryRepository: { findById: (id) => libraries.find((library) => library.id === id) },
    settings: { language: () => 'fr-FR' },
    jobQueue: jobs.queue,
    eventBus: events.bus,
    ids: createSequentialIds('img-'),
    clock: createManualClock(now),
    logger,
  }
  return {
    getItemMetadata: getItemMetadataFactory(deps),
    setItemOverrides: setItemOverridesFactory(deps),
    removeItemOverride: removeItemOverrideFactory(deps),
    listImageAlternatives: listImageAlternativesFactory(deps),
    setItemImage: setItemImageFactory(deps),
    requestItemRefresh: requestItemRefreshFactory(deps),
    requestLibraryRefresh: requestLibraryRefreshFactory(deps),
    stored,
    images,
    overridesSet,
    overridesRemoved,
    inserted,
    deleteAsked,
    written,
    removedFiles,
    encoded,
    fetchedFor,
    tmdbCallsTo: fake.callsTo,
    events: events.events,
    enqueued: jobs.enqueued,
    lines,
  }
}

export const notFound = { ok: false, error: { code: 'item/not_found', context: { id: 'nope' } } }
