import { describe, expect, test } from 'bun:test'

import { appError, err, ok } from '@projo/shared'
import { maxImageUploadBytes } from '@projo/shared/api/metadata'

import { createManualClock } from '../../../test/support/clock.ts'
import {
  createRecordingEventBus,
  createRecordingJobQueue,
  createSequentialIds,
} from '../../../test/support/fakes.ts'
import { createCapturingLogger } from '../../../test/support/logger.ts'
import { createFakeTmdb, tmdbFailure } from '../../../test/support/metadata-fakes.ts'
import type { Library } from '../../core/library/library.ts'
import type {
  EditableItem,
  ImageReencoder,
  ItemOverrideRepository,
  ItemOverrides,
} from '../../core/metadata/editing.ts'
import type { ItemMetadata, LockableField } from '../../core/metadata/enrichment.ts'
import type { ItemImageContext, StoredImage } from '../../core/metadata/ports.ts'
import type { TmdbApi, TmdbImage } from '../../core/metadata/tmdb.ts'
import { metadataEditingFactory } from './metadata-editing.ts'

const now = new Date('2026-05-01T12:00:00.000Z')

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0])
const NOT_AN_IMAGE = new Uint8Array([1, 2, 3, 4])

const overrideKeyOf: Record<LockableField, keyof ItemOverrides> = {
  title: 'title',
  year: 'year',
  overview: 'overview',
  genres: 'genres',
  poster_image_id: 'posterImageId',
  backdrop_image_id: 'backdropImageId',
}

const movieItem: EditableItem = {
  id: 'movie',
  kind: 'movie',
  tmdbId: 27205,
  title: 'Inception',
  year: 2010,
  genres: ['action'],
}
const localItem: EditableItem = { id: 'local', kind: 'movie', title: 'Home video', genres: [] }

const poster = (path: string, overrides: Partial<TmdbImage> = {}): TmdbImage => ({
  path,
  width: 1000,
  height: 1500,
  voteAverage: 5,
  ...overrides,
})

type EditingDeps = Parameters<typeof metadataEditingFactory>[0]

type Options = {
  items?: EditableItem[]
  contexts?: ItemImageContext[]
  tmdb?: Partial<TmdbApi>
  currentImages?: Record<string, { imageId: string; tmdbPath?: string }>
  storedImages?: StoredImage[]
  currentMetadata?: EditingDeps['refresh']['currentMetadata']
  fetchImages?: EditingDeps['fetchImages']
  reencoder?: ImageReencoder
  writeFails?: boolean
  libraries?: Library[]
}

const setup = ({
  items = [movieItem, localItem],
  contexts = [{ id: 'movie', kind: 'movie', tmdbId: 27205 }],
  tmdb: tmdbOverrides = {},
  currentImages = {},
  storedImages = [],
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
  const stored = new Map<string, ItemOverrides>()
  const overridesSet: Parameters<ItemOverrideRepository['set']>[0][] = []
  const overridesRemoved: Parameters<ItemOverrideRepository['remove']>[0][] = []
  const overrides: ItemOverrideRepository = {
    item: (itemId) => rows.get(itemId),
    get: (itemId) => stored.get(itemId) ?? {},
    set: (input) => {
      overridesSet.push(input)
      stored.set(input.itemId, { ...stored.get(input.itemId), ...input.overrides })
    },
    remove: (input) => {
      overridesRemoved.push(input)
      const next = { ...stored.get(input.itemId) }
      delete next[overrideKeyOf[input.field]]
      stored.set(input.itemId, next)
    },
  }
  const images = new Map(storedImages.map((image) => [image.id, image]))
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
  const editing = metadataEditingFactory({
    overrides,
    items: { imageContext: (itemId) => contexts.find((context) => context.id === itemId) },
    images: {
      findById: (id) => images.get(id),
      itemImage: ({ itemId, slot }) => {
        const current = currentImages[`${itemId}:${slot}`]
        return current === undefined ? undefined : { ...current, origin: 'tmdb' }
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
        const image = images.get(id)
        images.delete(id)
        return image
      },
      listUnused: () => [],
    },
    files: {
      write: async ({ relativePath }) => {
        if (writeFails) return err(appError('metadata/image_failed', 'disk full'))
        written.push(relativePath)
        return ok()
      },
      remove: async (relativePath) => void removedFiles.push(relativePath),
      absolutePath: (relativePath) => `/data/images/${relativePath}`,
    },
    encodeVariants: async (localPath) => void encoded.push(localPath),
    tmdb: fake.tmdb,
    refresh: { currentMetadata },
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
  })
  return {
    editing,
    stored,
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

const notFound = { ok: false, error: { code: 'item/not_found', context: { id: 'nope' } } }

describe('reading an item', () => {
  test('an unknown item: item/not_found', () => {
    expect(setup().editing.get({ itemId: 'nope' })).toMatchObject(notFound)
  })

  test('the item with the fields its overrides lock', () => {
    const world = setup()
    world.stored.set('movie', { title: 'Mine', posterImageId: 'img' })
    expect(world.editing.get({ itemId: 'movie' })).toEqual(
      ok({ ...movieItem, locked: ['title', 'poster'] }),
    )
  })
})

describe('editing text fields (§9.3)', () => {
  test('an unknown item: nothing stored, nothing published', () => {
    const world = setup()
    expect(world.editing.setOverrides({ itemId: 'nope', overrides: { title: 'X' } })).toMatchObject(
      notFound,
    )
    expect(world.overridesSet).toEqual([])
    expect(world.events).toEqual([])
  })

  test('stored as overrides, the catalog told, the fields now locked', () => {
    const world = setup()
    const result = world.editing.setOverrides({
      itemId: 'movie',
      overrides: { title: 'Mine', genres: ['drama'] },
    })
    expect(world.overridesSet).toEqual([
      { itemId: 'movie', overrides: { title: 'Mine', genres: ['drama'] }, at: now },
    ])
    expect(world.events).toEqual([{ type: 'catalog.changed', payload: {} }])
    expect(result.ok && result.value.locked).toEqual(['title', 'genres'])
  })
})

describe('"Back to TMDB"', () => {
  test('an unknown item: item/not_found', async () => {
    expect(await setup().editing.removeOverride({ itemId: 'nope', field: 'title' })).toMatchObject(
      notFound,
    )
  })

  test('a text field gets the current TMDB value back', async () => {
    const tmdbValue: ItemMetadata = { title: 'Inception', year: 2010, genres: ['action'] }
    const world = setup({ currentMetadata: async () => ok(tmdbValue) })
    world.stored.set('movie', { title: 'Mine', year: 1999 })
    const result = await world.editing.removeOverride({ itemId: 'movie', field: 'title' })
    expect(world.overridesRemoved).toEqual([
      { itemId: 'movie', field: 'title', restored: { title: 'Inception' }, at: now },
    ])
    expect(result.ok && result.value.locked).toEqual(['year'])
    expect(world.events).toEqual([{ type: 'catalog.changed', payload: {} }])
  })

  test('TMDB unreachable: the lock goes anyway, the value stays until the next refresh', async () => {
    const world = setup({ currentMetadata: async () => tmdbFailure() })
    world.stored.set('movie', { genres: ['drama'] })
    const result = await world.editing.removeOverride({ itemId: 'movie', field: 'genres' })
    expect(world.overridesRemoved).toEqual([{ itemId: 'movie', field: 'genres', at: now }])
    expect(result.ok && result.value.locked).toEqual([])
  })

  test('an image: unlocked, then the TMDB images fetched again', async () => {
    const world = setup()
    world.stored.set('movie', { posterImageId: 'custom' })
    const result = await world.editing.removeOverride({ itemId: 'movie', field: 'poster' })
    expect(world.overridesRemoved).toEqual([{ itemId: 'movie', field: 'poster_image_id', at: now }])
    expect(world.fetchedFor).toEqual(['movie'])
    expect(result.ok).toBe(true)
  })

  test('an image whose fetch fails is still unlocked, with a warning', async () => {
    const world = setup({
      fetchImages: async () => err(appError('metadata/image_failed', 'download failed')),
    })
    const result = await world.editing.removeOverride({ itemId: 'movie', field: 'backdrop' })
    expect(result.ok).toBe(true)
    expect(world.lines).toContainEqual(
      expect.objectContaining({
        level: 'warn',
        fields: expect.objectContaining({ code: 'metadata/image_failed' }),
      }),
    )
  })

  test('the image of a local item is only unlocked', async () => {
    const world = setup()
    await world.editing.removeOverride({ itemId: 'local', field: 'poster' })
    expect(world.overridesRemoved).toHaveLength(1)
    expect(world.fetchedFor).toEqual([])
  })
})

describe('image alternatives', () => {
  test('an unknown item: item/not_found', async () => {
    expect(await setup().editing.alternatives({ itemId: 'nope', kind: 'poster' })).toMatchObject(
      notFound,
    )
  })

  test('a local item: metadata/not_matched', async () => {
    expect(await setup().editing.alternatives({ itemId: 'local', kind: 'poster' })).toMatchObject({
      ok: false,
      error: { code: 'metadata/not_matched', context: { id: 'local' } },
    })
  })

  test('best voted first, then the widest, the current one flagged', async () => {
    const world = setup({
      tmdb: {
        images: async () =>
          ok({
            posters: [
              poster('/low.jpg', { voteAverage: 3 }),
              poster('/narrow.jpg', { voteAverage: 8, width: 500, height: 750 }),
              poster('/wide.jpg', { voteAverage: 8, width: 2000, height: 3000, language: 'fr' }),
            ],
            backdrops: [poster('/backdrop.jpg')],
            logos: [],
          }),
      },
      currentImages: { 'movie:poster': { imageId: 'p', tmdbPath: '/narrow.jpg' } },
    })
    const result = await world.editing.alternatives({ itemId: 'movie', kind: 'poster' })
    expect(result).toEqual(
      ok([
        {
          tmdbPath: '/wide.jpg',
          width: 2000,
          height: 3000,
          voteAverage: 8,
          language: 'fr',
          current: false,
        },
        { tmdbPath: '/narrow.jpg', width: 500, height: 750, voteAverage: 8, current: true },
        { tmdbPath: '/low.jpg', width: 1000, height: 1500, voteAverage: 3, current: false },
      ]),
    )
    expect(world.tmdbCallsTo('images')).toEqual([
      { target: { kind: 'movie', tmdbId: 27205 }, language: 'fr-FR' },
    ])
  })

  test('at most 60 alternatives', async () => {
    const posters = Array.from({ length: 61 }, (_, i) => poster(`/${i}.jpg`))
    const world = setup({ tmdb: { images: async () => ok({ posters, backdrops: [], logos: [] }) } })
    const result = await world.editing.alternatives({ itemId: 'movie', kind: 'poster' })
    expect(result.ok && result.value).toHaveLength(60)
  })

  test('a season offers its own posters, the series backdrops, in its library language', async () => {
    const world = setup({
      items: [{ id: 'season', kind: 'season', genres: [], tmdbId: 900 }],
      contexts: [
        {
          id: 'season',
          kind: 'season',
          tmdbId: 900,
          seasonNumber: 2,
          seriesTmdbId: 70523,
          libraryLanguage: 'de-DE',
        },
      ],
    })
    await world.editing.alternatives({ itemId: 'season', kind: 'poster' })
    await world.editing.alternatives({ itemId: 'season', kind: 'backdrop' })
    expect(world.tmdbCallsTo('images')).toEqual([
      { target: { kind: 'season', seriesTmdbId: 70523, seasonNumber: 2 }, language: 'de-DE' },
      { target: { kind: 'series', tmdbId: 70523 }, language: 'de-DE' },
    ])
  })

  test('an episode offers the series images; without its series id, not_matched', async () => {
    const world = setup({
      items: [
        { id: 'episode', kind: 'episode', genres: [], tmdbId: 1001 },
        { id: 'orphan', kind: 'episode', genres: [], tmdbId: 1002 },
      ],
      contexts: [
        { id: 'episode', kind: 'episode', tmdbId: 1001, seriesTmdbId: 70523 },
        { id: 'orphan', kind: 'episode', tmdbId: 1002 },
      ],
    })
    await world.editing.alternatives({ itemId: 'episode', kind: 'poster' })
    expect(world.tmdbCallsTo('images')).toEqual([
      { target: { kind: 'series', tmdbId: 70523 }, language: 'fr-FR' },
    ])
    expect(await world.editing.alternatives({ itemId: 'orphan', kind: 'poster' })).toMatchObject({
      ok: false,
      error: { code: 'metadata/not_matched' },
    })
  })

  test('a TMDB failure is returned', async () => {
    const world = setup({ tmdb: { images: async () => tmdbFailure() } })
    expect(await world.editing.alternatives({ itemId: 'movie', kind: 'poster' })).toMatchObject({
      ok: false,
      error: { code: 'metadata/tmdb_unavailable' },
    })
  })
})

describe('choosing a TMDB image', () => {
  const tmdbImages: Partial<TmdbApi> = {
    images: async () =>
      ok({
        posters: [poster('/chosen.jpg', { language: 'en', width: 1000, height: 1500 })],
        backdrops: [],
        logos: [],
      }),
    downloadImage: async () => ok({ bytes: JPEG, contentType: 'image/png' }),
  }

  test('downloaded, stored with its variants, locked; the previous file goes', async () => {
    const world = setup({
      tmdb: tmdbImages,
      currentImages: { 'movie:poster': { imageId: 'old', tmdbPath: '/old.jpg' } },
      storedImages: [
        {
          id: 'old',
          kind: 'poster',
          origin: 'tmdb',
          localPath: 'posters/old.jpg',
          width: 500,
          height: 750,
        },
      ],
    })
    const result = await world.editing.setImage({
      itemId: 'movie',
      choice: { kind: 'poster', tmdbPath: '/chosen.jpg' },
    })

    expect(world.tmdbCallsTo('downloadImage')).toEqual([{ path: '/chosen.jpg', size: 'w500' }])
    expect(world.written).toEqual(['posters/img-1.png'])
    expect(world.encoded).toEqual(['posters/img-1.png'])
    expect(world.inserted).toEqual([
      {
        id: 'img-1',
        kind: 'poster',
        origin: 'tmdb',
        tmdbPath: '/chosen.jpg',
        localPath: 'posters/img-1.png',
        width: 500,
        height: 750,
        language: 'en',
      },
    ])
    expect(world.overridesSet).toEqual([
      { itemId: 'movie', overrides: { posterImageId: 'img-1' }, at: now },
    ])
    expect(world.deleteAsked).toEqual(['old'])
    expect(world.removedFiles).toEqual(['posters/old.jpg'])
    expect(world.events).toEqual([{ type: 'catalog.changed', payload: {} }])
    expect(result.ok && result.value.locked).toEqual(['poster'])
  })

  test('a backdrop is downloaded at w1280 into backdrops/, its extension from the path', async () => {
    const world = setup({
      tmdb: {
        downloadImage: async () => ok({ bytes: JPEG, contentType: 'application/octet-stream' }),
      },
    })
    await world.editing.setImage({
      itemId: 'movie',
      choice: { kind: 'backdrop', tmdbPath: '/wide.WEBP' },
    })
    expect(world.tmdbCallsTo('downloadImage')).toEqual([{ path: '/wide.WEBP', size: 'w1280' }])
    expect(world.written).toEqual(['backdrops/img-1.webp'])
    expect(world.overridesSet[0]?.overrides).toEqual({ backdropImageId: 'img-1' })
  })

  test('a local item: metadata/not_matched, nothing downloaded', async () => {
    const world = setup({ tmdb: tmdbImages })
    expect(
      await world.editing.setImage({
        itemId: 'local',
        choice: { kind: 'poster', tmdbPath: '/chosen.jpg' },
      }),
    ).toMatchObject({ ok: false, error: { code: 'metadata/not_matched' } })
    expect(world.tmdbCallsTo('downloadImage')).toEqual([])
  })

  test('a failed download stores nothing', async () => {
    const world = setup({ tmdb: { downloadImage: async () => tmdbFailure() } })
    expect(
      await world.editing.setImage({
        itemId: 'movie',
        choice: { kind: 'poster', tmdbPath: '/chosen.jpg' },
      }),
    ).toMatchObject({ ok: false, error: { code: 'metadata/tmdb_unavailable' } })
    expect(world.inserted).toEqual([])
    expect(world.overridesSet).toEqual([])
    expect(world.events).toEqual([])
  })

  test('a file that cannot be written stores nothing', async () => {
    const world = setup({ tmdb: tmdbImages, writeFails: true })
    expect(
      await world.editing.setImage({
        itemId: 'movie',
        choice: { kind: 'poster', tmdbPath: '/chosen.jpg' },
      }),
    ).toMatchObject({ ok: false, error: { code: 'metadata/image_failed' } })
    expect(world.encoded).toEqual([])
    expect(world.inserted).toEqual([])
  })
})

describe('uploading an image', () => {
  const upload = (bytes: Uint8Array, sizeBytes = bytes.byteLength) => ({
    itemId: 'movie',
    choice: { kind: 'poster' as const, upload: { bytes, sizeBytes } },
  })

  test('an unknown item: item/not_found', async () => {
    expect(await setup().editing.setImage({ ...upload(JPEG), itemId: 'nope' })).toMatchObject(
      notFound,
    )
  })

  test('over 10 MB: image/too_large, before reading it', async () => {
    const world = setup()
    expect(await world.editing.setImage(upload(JPEG, maxImageUploadBytes + 1))).toMatchObject({
      ok: false,
      error: {
        code: 'image/too_large',
        context: { sizeBytes: maxImageUploadBytes + 1, maxBytes: maxImageUploadBytes },
      },
    })
    expect(world.written).toEqual([])
  })

  test('not a JPEG, PNG or WebP: image/unsupported_type', async () => {
    expect(await setup().editing.setImage(upload(NOT_AN_IMAGE))).toMatchObject({
      ok: false,
      error: { code: 'image/unsupported_type' },
    })
  })

  test('a re-encoding failure is returned and nothing is stored', async () => {
    const world = setup({
      reencoder: { reencode: async () => err(appError('image/unreadable', 'corrupt image')) },
    })
    expect(await world.editing.setImage(upload(JPEG))).toMatchObject({
      ok: false,
      error: { code: 'image/unreadable' },
    })
    expect(world.inserted).toEqual([])
  })

  test('re-encoded into images/custom and locked; the same image is never deleted', async () => {
    const world = setup({ currentImages: { 'movie:poster': { imageId: 'img-1' } } })
    const result = await world.editing.setImage(upload(JPEG))
    expect(world.written).toEqual(['custom/img-1.webp'])
    expect(world.encoded).toEqual(['custom/img-1.webp'])
    expect(world.inserted).toEqual([
      {
        id: 'img-1',
        kind: 'poster',
        origin: 'custom',
        localPath: 'custom/img-1.webp',
        width: 600,
        height: 900,
      },
    ])
    expect(world.overridesSet).toEqual([
      { itemId: 'movie', overrides: { posterImageId: 'img-1' }, at: now },
    ])
    expect(world.deleteAsked).toEqual([])
    expect(result.ok && result.value.locked).toEqual(['poster'])
  })
})

describe('refreshing from TMDB (§9.4)', () => {
  test('an item: one deduplicated refresh job', () => {
    const world = setup()
    const result = world.editing.requestRefresh({ itemId: 'movie' })
    expect(result.ok && result.value).toMatchObject({ type: 'refresh_metadata', state: 'queued' })
    expect(world.enqueued).toEqual([
      { type: 'refresh_metadata', payload: { itemId: 'movie' }, dedupeKey: 'refresh:movie' },
    ])
  })

  test('an unknown item: item/not_found; a local one: metadata/not_matched', () => {
    const world = setup()
    expect(world.editing.requestRefresh({ itemId: 'nope' })).toMatchObject(notFound)
    expect(world.editing.requestRefresh({ itemId: 'local' })).toMatchObject({
      ok: false,
      error: { code: 'metadata/not_matched' },
    })
    expect(world.enqueued).toEqual([])
  })

  test('a library: one low-priority job, deduplicated per library', () => {
    const world = setup({
      libraries: [{ id: 'lib' } as Library],
    })
    expect(world.editing.requestLibraryRefresh({ libraryId: 'lib' }).ok).toBe(true)
    expect(world.enqueued).toEqual([
      {
        type: 'refresh_metadata',
        payload: { libraryId: 'lib' },
        dedupeKey: 'library-refresh:lib',
        priority: 10,
      },
    ])
  })

  test('an unknown library: library/not_found', () => {
    const world = setup()
    expect(world.editing.requestLibraryRefresh({ libraryId: 'nope' })).toMatchObject({
      ok: false,
      error: { code: 'library/not_found', context: { libraryId: 'nope' } },
    })
    expect(world.enqueued).toEqual([])
  })
})
