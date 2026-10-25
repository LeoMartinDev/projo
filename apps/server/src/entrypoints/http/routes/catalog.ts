import { type Context, Hono } from 'hono'

import {
  type CatalogListQuery,
  catalogListQuerySchema,
  type GenreList,
  genresQuerySchema,
  type ItemChildren,
  type ItemDetailDto,
  type ItemImagesDto,
  type ItemPage,
  type ItemRefDto,
  type ItemSummaryDto,
  type PersonDto,
  type PlayTargetDto,
  type SourceDto,
} from '@projo/shared/api/catalog'
import type { ContentRatingDto } from '@projo/shared/api/content-ratings'

import type { CatalogEntry } from '../../../application/catalog/catalog-entries.ts'
import type { GetItem } from '../../../application/catalog/get-item.ts'
import type { ListCatalog, ListGenres } from '../../../application/catalog/list-catalog.ts'
import type { ListChildren } from '../../../application/catalog/list-children.ts'
import type { PlayButton } from '../../../application/catalog/series-play.ts'
import type {
  CatalogItem,
  ItemImageIds,
  ItemPerson,
  PlayableSource,
  VisibilityScopeResolver,
} from '../../../core/catalog/catalog.ts'
import { ratingTier } from '../../../core/profile/content-rating.ts'
import type { AppEnv } from '../context.ts'
import { respondError } from '../errors.ts'
import { currentProfileId } from '../principal.ts'
import { validate } from '../validation.ts'
import { progressFields } from './progress.ts'

const optional = <K extends string, V>(key: K, value: V | undefined) =>
  (value === undefined ? {} : { [key]: value }) as { [P in K]?: V }

/** `2025-06-26` → 2025. */
const yearOf = (date: string | undefined): number | undefined => {
  const year = date === undefined ? Number.NaN : Number.parseInt(date.slice(0, 4), 10)
  return Number.isInteger(year) ? year : undefined
}

/** §9.1: images are served by `GET /api/v1/images/:id` (immutable, the id changes with the file). */
export const imageUrl = (imageId: string): string => `/api/v1/images/${encodeURIComponent(imageId)}`

const imageOf = (imageId: string | undefined) =>
  imageId === undefined ? undefined : imageUrl(imageId)

export const toImagesDto = (item: ItemImageIds): ItemImagesDto => ({
  ...optional('poster', imageOf(item.posterImageId)),
  ...optional('backdrop', imageOf(item.backdropImageId)),
  ...optional('logo', imageOf(item.logoImageId)),
  ...optional('still', imageOf(item.stillImageId)),
})

export const toItemRefDto = (item: CatalogItem): ItemRefDto => ({
  id: item.id,
  kind: item.kind,
  ...optional('title', item.title),
  ...optional('seasonNumber', item.seasonNumber),
  images: toImagesDto(item),
})

/** §9.1: the stored code and its country, with the §14 tier it falls in (the badge, §13.5). */
export const toContentRatingDto = ({
  contentRating: code,
  contentRatingCountry: country,
}: Pick<CatalogItem, 'contentRating' | 'contentRatingCountry'>): ContentRatingDto | undefined =>
  code === undefined
    ? undefined
    : {
        code,
        ...optional('country', country),
        ...optional('tier', country === undefined ? undefined : ratingTier(code, country)),
      }

export const toItemSummaryDto = ({
  item,
  progress,
  inWatchlist,
  series,
  seriesInWatchlist,
  bestQuality,
  seasonCount,
}: CatalogEntry): ItemSummaryDto => ({
  id: item.id,
  kind: item.kind,
  ...optional('title', item.title),
  sortTitle: item.sortTitle,
  ...optional('year', item.year),
  ...optional('endYear', item.kind === 'series' ? yearOf(item.lastAirDate) : undefined),
  ...optional('parentId', item.parentId),
  ...optional('seasonNumber', item.seasonNumber),
  ...optional('episodeNumber', item.episodeNumber),
  ...optional('episodeNumberEnd', item.episodeNumberEnd),
  ...optional('runtimeMinutes', item.runtimeMinutes),
  ...optional('durationMs', item.durationMs),
  ...optional('addedAt', item.addedAt?.toISOString()),
  images: toImagesDto(item),
  ...optional('contentRating', toContentRatingDto(item)),
  ...optional('voteAverage', item.voteAverage),
  ...optional('episodeCountTmdb', item.episodeCountTmdb),
  ...optional('seasonCount', seasonCount),
  genres: item.genres,
  ...optional('bestQuality', bestQuality),
  ...(item.kind === 'episode'
    ? { ...optional('overview', item.overview), ...optional('airDate', item.airDate) }
    : {}),
  ...optional('inWatchlist', inWatchlist),
  ...optional(
    'series',
    series && { ...toItemRefDto(series), ...optional('inWatchlist', seriesInWatchlist) },
  ),
  ...progressFields(progress),
})

export const toSourceDto = (source: PlayableSource): SourceDto => {
  const video = source.media?.video[0]
  return {
    id: source.id,
    version: source.version,
    ...optional('partIndex', source.partIndex),
    container: source.extension,
    sizeBytes: source.sizeBytes,
    ...optional('durationMs', source.media?.durationMs),
    ...(video === undefined
      ? {}
      : {
          video: {
            codec: video.codec,
            ...optional('width', video.width),
            ...optional('height', video.height),
          },
        }),
    audioTracks: (source.media?.audio ?? []).map((audio) => ({
      index: audio.index,
      codec: audio.codec,
      ...optional('channels', audio.channels),
      ...optional('language', audio.language),
      ...optional('title', audio.title),
      isDefault: audio.isDefault,
    })),
  }
}

const toPersonDto = (person: ItemPerson): PersonDto => ({
  id: person.id,
  name: person.name,
  role: person.role,
  ...optional('character', person.character),
  ...optional('photo', imageOf(person.profileImageId)),
})

export const toPlayTargetDto = (play: PlayButton): PlayTargetDto => ({
  action: play.action,
  itemId: play.item.id,
  ...optional('seasonNumber', play.item.seasonNumber),
  ...optional('episodeNumber', play.item.episodeNumber),
  ...optional('title', play.item.title),
  positionMs: play.positionMs,
})

type Deps = {
  listCatalog: ListCatalog
  listGenres: ListGenres
  getItem: GetItem
  listChildren: ListChildren
  /** What the active profile may see (§14: library access, content rating). */
  scopeFor: VisibilityScopeResolver
}

/**
 * §17.2 Catalogue: `/movies`, `/series`, `/genres`, `/items/:id`, `/items/:id/children` (`/home`
 * and `/search` have their own files; `/images/:id` belongs to the metadata domain). Mounted at
 * `/api/v1`. Middleware: per route or path-scoped, never `.use('*')` (the sub-app is mounted at a
 * shared prefix, a wildcard would leak to every other domain).
 */
export const catalogRoutes = ({
  listCatalog,
  listGenres,
  getItem,
  listChildren,
  scopeFor,
}: Deps) => {
  const page = async (c: Context<AppEnv>, kind: 'movie' | 'series', query: CatalogListQuery) => {
    const profileId = currentProfileId(c)
    if (!profileId.ok) return respondError(c, profileId.error)
    const result = await listCatalog({
      kind,
      sort: query.sort,
      limit: query.limit,
      profileId: profileId.value,
      scope: scopeFor(profileId.value),
      filters: {
        ...optional('genre', query.genre),
        ...optional('year', query.year),
        ...optional('decade', query.decade),
        ...optional('watch', query.watch),
      },
      ...optional('order', query.order),
      ...optional('cursor', query.cursor),
    })
    return result.ok
      ? c.json(
          {
            items: result.value.entries.map(toItemSummaryDto),
            ...optional('nextCursor', result.value.nextCursor),
          } satisfies ItemPage,
          200,
        )
      : respondError(c, result.error)
  }

  return new Hono<AppEnv>()
    .get('/movies', validate('query', catalogListQuerySchema), (c) =>
      page(c, 'movie', c.req.valid('query')),
    )
    .get('/series', validate('query', catalogListQuerySchema), (c) =>
      page(c, 'series', c.req.valid('query')),
    )
    .get('/genres', validate('query', genresQuerySchema), (c) => {
      const profileId = currentProfileId(c)
      if (!profileId.ok) return respondError(c, profileId.error)
      const { kind } = c.req.valid('query')
      return c.json(
        listGenres({
          ...optional('kind', kind),
          scope: scopeFor(profileId.value),
        }) satisfies GenreList,
        200,
      )
    })
    .get('/items/:id', async (c) => {
      const profileId = currentProfileId(c)
      if (!profileId.ok) return respondError(c, profileId.error)
      const result = await getItem({
        id: c.req.param('id'),
        profileId: profileId.value,
        scope: scopeFor(profileId.value),
      })
      if (!result.ok) return respondError(c, result.error)
      const detail = result.value
      const { item, series, season, people, media, play } = detail
      return c.json(
        {
          ...toItemSummaryDto({
            item,
            progress: detail.progress,
            ...optional('inWatchlist', detail.inWatchlist),
            ...optional('series', series),
            ...optional('seasonCount', detail.seasonCount),
          }),
          ...optional('originalTitle', item.originalTitle),
          ...optional('overview', item.overview),
          genres: item.genres,
          ...optional('releaseDate', item.releaseDate),
          ...optional('airDate', item.airDate),
          ...optional('originalLanguage', item.originalLanguage),
          ...optional('seriesStatus', item.seriesStatus),
          ...optional('season', season && toItemRefDto(season)),
          sources: detail.sources.map(toSourceDto),
          cast: people.filter((person) => person.role === 'cast').map(toPersonDto),
          crew: people.filter((person) => person.role !== 'cast').map(toPersonDto),
          ...optional('bestQuality', media.bestQuality),
          ...optional('firstEpisodeId', detail.firstEpisodeId),
          audioLanguages: media.audioLanguages,
          subtitleLanguages: media.subtitleLanguages,
          ...optional('play', play && toPlayTargetDto(play)),
        } satisfies ItemDetailDto,
        200,
      )
    })
    .get('/items/:id/children', async (c) => {
      const profileId = currentProfileId(c)
      if (!profileId.ok) return respondError(c, profileId.error)
      const result = await listChildren({
        id: c.req.param('id'),
        profileId: profileId.value,
        scope: scopeFor(profileId.value),
      })
      return result.ok
        ? c.json({ items: result.value.map(toItemSummaryDto) } satisfies ItemChildren, 200)
        : respondError(c, result.error)
    })
}

export type CatalogRoutes = ReturnType<typeof catalogRoutes>
