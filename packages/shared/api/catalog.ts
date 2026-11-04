import { z } from 'zod'

import { paginationQuerySchema } from './common.ts'
import { contentRatingDtoSchema } from './content-ratings.ts'
import { genreIdSchema } from './genres.ts'
import { itemProgressDtoSchema, watchStatusDtoSchema } from './progress.ts'
import { dynamicRangeSchema, resolutionSchema, sourceVersionDtoSchema } from './versions.ts'

export const itemKindSchema = z.enum(['movie', 'series', 'season', 'episode'])
export type ItemKind = z.infer<typeof itemKindSchema>

export const seriesStatuses = ['in_production', 'ended', 'canceled'] as const
export const seriesStatusSchema = z.enum(seriesStatuses)
export type SeriesStatus = z.infer<typeof seriesStatusSchema>

export const catalogSortSchema = z.enum(['title', 'added', 'year', 'rating'])
export type CatalogSort = z.infer<typeof catalogSortSchema>

export const watchFilterSchema = z.enum(['watched', 'unwatched', 'in_progress'])
export type WatchFilter = z.infer<typeof watchFilterSchema>

export const catalogListQuerySchema = paginationQuerySchema
  .extend({
    sort: catalogSortSchema.default('title'),
    genre: genreIdSchema.optional(),
    year: z.coerce.number().int().min(1800).max(3000).optional(),
    decade: z.coerce
      .number()
      .int()
      .min(1800)
      .max(3000)
      .refine((value) => value % 10 === 0, 'a decade starts on a year ending in 0')
      .optional(),
    watch: watchFilterSchema.optional(),
  })
  .refine((query) => query.year === undefined || query.decade === undefined, {
    message: 'year and decade are exclusive',
    path: ['decade'],
  })
export type CatalogListQuery = z.infer<typeof catalogListQuerySchema>

export const genresQuerySchema = z.object({ kind: z.enum(['movie', 'series']).optional() })
export const genreListSchema = z.object({
  genres: z.array(genreIdSchema),
  years: z.object({ min: z.number().int(), max: z.number().int() }).optional(),
})
export type GenreList = z.infer<typeof genreListSchema>

export const itemImagesDtoSchema = z.object({
  poster: z.string().optional(),
  backdrop: z.string().optional(),
  logo: z.string().optional(),
  still: z.string().optional(),
})
export type ItemImagesDto = z.infer<typeof itemImagesDtoSchema>

export const imageWidths = [185, 342, 500, 780, 1280] as const

export const imageQuerySchema = z.object({
  w: z.coerce
    .number()
    .refine((w) => (imageWidths as readonly number[]).includes(w))
    .optional(),
})

export const videoQualityDtoSchema = z.object({
  resolution: resolutionSchema,
  dynamicRange: dynamicRangeSchema,
})
export type VideoQualityDto = z.infer<typeof videoQualityDtoSchema>

export const itemRefDtoSchema = z.object({
  id: z.string(),
  kind: itemKindSchema,
  title: z.string().optional(),
  seasonNumber: z.number().int().optional(),
  images: itemImagesDtoSchema.optional(),
  inWatchlist: z.boolean().optional(),
})
export type ItemRefDto = z.infer<typeof itemRefDtoSchema>

export const itemSummaryDtoSchema = z.object({
  id: z.string(),
  kind: itemKindSchema,
  title: z.string().optional(),
  sortTitle: z.string(),
  year: z.number().int().optional(),
  endYear: z.number().int().optional(),
  parentId: z.string().optional(),
  seasonNumber: z.number().int().optional(),
  episodeNumber: z.number().int().optional(),
  episodeNumberEnd: z.number().int().optional(),
  runtimeMinutes: z.number().int().optional(),
  durationMs: z.number().int().optional(),
  addedAt: z.string().optional(),
  images: itemImagesDtoSchema,
  contentRating: contentRatingDtoSchema.optional(),
  voteAverage: z.number().optional(),
  episodeCountTmdb: z.number().int().optional(),
  seasonCount: z.number().int().optional(),
  genres: z.array(genreIdSchema),
  bestQuality: videoQualityDtoSchema.optional(),
  overview: z.string().optional(),
  airDate: z.string().optional(),
  inWatchlist: z.boolean().optional(),
  series: itemRefDtoSchema.optional(),
  progress: itemProgressDtoSchema.optional(),
  watchStatus: watchStatusDtoSchema.optional(),
})
export type ItemSummaryDto = z.infer<typeof itemSummaryDtoSchema>

export const itemPageSchema = z.object({
  items: z.array(itemSummaryDtoSchema),
  nextCursor: z.string().optional(),
})
export type ItemPage = z.infer<typeof itemPageSchema>

export const sourceDtoSchema = z.object({
  id: z.string(),
  version: sourceVersionDtoSchema,
  partIndex: z.number().int().optional(),
  container: z.string(),
  sizeBytes: z.number().int(),
  durationMs: z.number().int().optional(),
  video: z
    .object({
      codec: z.string(),
      width: z.number().int().optional(),
      height: z.number().int().optional(),
    })
    .optional(),
  audioTracks: z.array(
    z.object({
      index: z.number().int(),
      codec: z.string(),
      channels: z.number().int().optional(),
      language: z.string().optional(),
      title: z.string().optional(),
      isDefault: z.boolean(),
    }),
  ),
})
export type SourceDto = z.infer<typeof sourceDtoSchema>

export const personDtoSchema = z.object({
  id: z.string(),
  name: z.string(),
  role: z.enum(['cast', 'director', 'writer']),
  character: z.string().optional(),
  photo: z.string().optional(),
})
export type PersonDto = z.infer<typeof personDtoSchema>

export const playTargetDtoSchema = z.object({
  action: z.enum(['resume', 'play']),
  itemId: z.string(),
  seasonNumber: z.number().int().optional(),
  episodeNumber: z.number().int().optional(),
  title: z.string().optional(),
  positionMs: z.number().int(),
})
export type PlayTargetDto = z.infer<typeof playTargetDtoSchema>

export const itemDetailDtoSchema = itemSummaryDtoSchema.extend({
  originalTitle: z.string().optional(),
  overview: z.string().optional(),
  releaseDate: z.string().optional(),
  originalLanguage: z.string().optional(),
  seriesStatus: seriesStatusSchema.optional(),
  season: itemRefDtoSchema.optional(),
  sources: z.array(sourceDtoSchema),
  cast: z.array(personDtoSchema),
  crew: z.array(personDtoSchema),
  firstEpisodeId: z.string().optional(),
  audioLanguages: z.array(z.string()),
  subtitleLanguages: z.array(z.string()),
  play: playTargetDtoSchema.optional(),
})
export type ItemDetailDto = z.infer<typeof itemDetailDtoSchema>

export const itemChildrenSchema = z.object({
  items: z.array(itemSummaryDtoSchema),
})
export type ItemChildren = z.infer<typeof itemChildrenSchema>
