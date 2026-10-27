import { type AppError, err, ok, type Result } from '@projo/shared'

import type { IdGenerator } from '../../core/ids.ts'
import type { Logger } from '../../core/logger.ts'
import {
  chooseImages,
  episodeStillChoice,
  type ImageChoice,
  type ImageSlot,
  type LockableField,
  profileDimensions,
  seasonPosterChoice,
} from '../../core/metadata/enrichment.ts'
import type {
  ImageFiles,
  ImageRepository,
  ItemImageContext,
  MetadataItemRepository,
  MetadataSettings,
} from '../../core/metadata/ports.ts'
import type { TmdbApi, TmdbError, TmdbImageSize } from '../../core/metadata/tmdb.ts'

type Deps = {
  tmdb: TmdbApi
  items: Pick<MetadataItemRepository, 'imageContext' | 'lockedFields' | 'peopleOf'>
  images: ImageRepository
  files: ImageFiles
  /** WebP variants of a written image (§9.1). */
  encodeVariants: (localPath: string) => Promise<void>
  settings: Pick<MetadataSettings, 'language'>
  ids: IdGenerator
  logger: Logger
}

/** Responses of the matching are reused (§9.2 database cache): no second request in general. */
const CACHED_DETAILS_MAX_AGE_MS = 30 * 24 * 60 * 60_000

export type FetchImagesError = AppError<
  'metadata/tmdb_unavailable' | 'metadata/tmdb_invalid_response' | 'metadata/image_failed'
>

/** Folder per kind under `/data/images` (§5.4). */
const folderOf: Record<ImageSlot | 'profile', string> = {
  poster: 'posters',
  backdrop: 'backdrops',
  logo: 'logos',
  still: 'stills',
  profile: 'people',
}

const extensionOf = (contentType: string, path: string): string => {
  if (contentType.includes('png')) return 'png'
  if (contentType.includes('webp')) return 'webp'
  if (contentType.includes('jpeg') || contentType.includes('jpg')) return 'jpg'
  const fromPath = /\.([a-z0-9]{2,4})$/iu.exec(path)?.[1]?.toLowerCase()
  return fromPath ?? 'jpg'
}

const slotLock: Partial<Record<ImageSlot, LockableField>> = {
  poster: 'poster_image_id',
  backdrop: 'backdrop_image_id',
}

type Wanted = { choices: ImageChoice[]; people: Map<number, string> }

/**
 * Job `fetch_images` (§9.1, §18, by item): downloads the chosen TMDB images (poster w500,
 * backdrop w1280, logo w500 PNG, still w300) and the cast photos (w185) into
 * `/data/images/<kind>/<id>.<ext>` with their WebP variants; never hotlinked. Idempotent: an image
 * already stored for the same TMDB path is kept; a locked poster or backdrop (§9.3) is never
 * replaced.
 */
export const fetchImagesFactory = ({
  tmdb,
  items,
  images,
  files,
  encodeVariants,
  settings,
  ids,
  logger,
}: Deps) => {
  const wantedFor = async (
    context: ItemImageContext,
    language: string,
  ): Promise<Result<Wanted | undefined, TmdbError>> => {
    const maxAgeMs = CACHED_DETAILS_MAX_AGE_MS
    if (context.tmdbId === undefined) return ok(undefined)
    switch (context.kind) {
      case 'movie': {
        const movie = await tmdb.movie({ tmdbId: context.tmdbId, language, maxAgeMs })
        if (!movie.ok) return movie
        return ok({
          choices: chooseImages(movie.value.images, language, movie.value),
          people: profilePaths([...movie.value.credits.cast, ...movie.value.credits.crew]),
        })
      }
      case 'series': {
        const series = await tmdb.series({ tmdbId: context.tmdbId, language, maxAgeMs })
        if (!series.ok) return series
        return ok({
          choices: chooseImages(series.value.images, language, series.value),
          people: profilePaths([
            ...series.value.credits.cast,
            ...series.value.credits.crew,
            ...series.value.createdBy,
          ]),
        })
      }
      case 'season':
      case 'episode': {
        if (context.seriesTmdbId === undefined || context.seasonNumber === undefined) {
          return ok(undefined)
        }
        const season = await tmdb.season({
          seriesTmdbId: context.seriesTmdbId,
          seasonNumber: context.seasonNumber,
          language,
          maxAgeMs,
        })
        if (!season.ok) return season
        const choice =
          context.kind === 'season'
            ? seasonPosterChoice(season.value)
            : (() => {
                const episode = season.value.episodes.find(
                  (e) => e.episodeNumber === context.episodeNumber,
                )
                return episode === undefined ? undefined : episodeStillChoice(episode)
              })()
        return ok({ choices: choice === undefined ? [] : [choice], people: new Map() })
      }
    }
  }

  const download = async (
    path: string,
    size: TmdbImageSize,
    kind: ImageSlot | 'profile',
  ): Promise<Result<{ id: string; localPath: string } | undefined, FetchImagesError>> => {
    const fetched = await tmdb.downloadImage({ path, size })
    if (!fetched.ok) {
      // Gone from TMDB: nothing to show, not worth a retry.
      if (fetched.error.code === 'metadata/tmdb_not_found') return ok(undefined)
      if (
        fetched.error.code === 'metadata/tmdb_unavailable' ||
        fetched.error.code === 'metadata/tmdb_invalid_response'
      ) {
        return err({ ...fetched.error, code: fetched.error.code })
      }
      return ok(undefined)
    }
    const id = ids.next()
    const localPath = `${folderOf[kind]}/${id}.${extensionOf(fetched.value.contentType, path)}`
    const written = await files.write({ relativePath: localPath, bytes: fetched.value.bytes })
    if (!written.ok) return written
    await encodeVariants(localPath)
    return ok({ id, localPath })
  }

  return async ({
    itemId,
  }: {
    itemId: string
  }): Promise<Result<{ downloaded: number }, FetchImagesError>> => {
    const context = items.imageContext(itemId)
    if (context === undefined) return ok({ downloaded: 0 })
    const language = context.libraryLanguage ?? settings.language()
    const wanted = await wantedFor(context, language)
    if (!wanted.ok) {
      const { error } = wanted
      if (
        error.code === 'metadata/tmdb_unavailable' ||
        error.code === 'metadata/tmdb_invalid_response'
      ) {
        return err({ ...error, code: error.code })
      }
      // No key, refused key, unknown id: nothing to fetch now.
      logger.info('images skipped', { itemId, code: error.code })
      return ok({ downloaded: 0 })
    }
    if (wanted.value === undefined) return ok({ downloaded: 0 })
    let downloaded = 0
    const locked = items.lockedFields(itemId)

    for (const choice of wanted.value.choices) {
      const lock = slotLock[choice.slot]
      if (lock !== undefined && locked.has(lock)) continue
      const current = images.itemImage({ itemId, slot: choice.slot })
      // A custom image is locked (§9.3); once unlocked ("Back to the TMDB value") TMDB's choice replaces it.
      if (current?.tmdbPath === choice.path) continue
      const stored = await download(choice.path, choice.size, choice.slot)
      if (!stored.ok) return stored
      if (stored.value === undefined) continue
      images.insert({
        id: stored.value.id,
        kind: choice.slot,
        origin: 'tmdb',
        tmdbPath: choice.path,
        localPath: stored.value.localPath,
        width: choice.width,
        height: choice.height,
        ...(choice.language === undefined ? {} : { language: choice.language }),
      })
      images.setItemImage({ itemId, slot: choice.slot, imageId: stored.value.id })
      downloaded += 1
      if (current !== undefined) {
        const removed = images.deleteIfUnused(current.imageId)
        if (removed !== undefined) await files.remove(removed.localPath)
      }
    }

    for (const person of items.peopleOf(itemId)) {
      if (person.profileImageId !== undefined) continue
      const path = wanted.value.people.get(person.tmdbId)
      if (path === undefined) continue
      const stored = await download(path, 'w185', 'profile')
      if (!stored.ok) return stored
      if (stored.value === undefined) continue
      images.insert({
        id: stored.value.id,
        kind: 'profile',
        origin: 'tmdb',
        tmdbPath: path,
        localPath: stored.value.localPath,
        ...profileDimensions(),
      })
      images.setPersonImage({ personId: person.personId, imageId: stored.value.id })
      downloaded += 1
    }
    if (downloaded > 0) logger.info('images fetched', { itemId, downloaded })
    return ok({ downloaded })
  }
}

const profilePaths = (
  people: readonly { tmdbId: number; profilePath?: string }[],
): Map<number, string> =>
  new Map(
    people.flatMap((person) =>
      person.profilePath === undefined ? [] : [[person.tmdbId, person.profilePath] as const],
    ),
  )

export type FetchImages = ReturnType<typeof fetchImagesFactory>
