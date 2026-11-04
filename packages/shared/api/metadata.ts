import { z } from 'zod'

import { genreIdSchema, MAX_ITEM_GENRES } from './genres.ts'

export const reviewReasonSchema = z.enum([
  'classification_ambiguous',
  'no_match',
  'ambiguous_match',
  'episode_not_found',
  'absolute_numbering',
  'date_based',
  'hint_conflict',
  'no_episode_number',
])
export type ReviewReason = z.infer<typeof reviewReasonSchema>

export const tmdbSearchKindSchema = z.enum(['movie', 'series'])
export type TmdbSearchKind = z.infer<typeof tmdbSearchKindSchema>

export const tmdbSearchQuerySchema = z.object({
  q: z.string().trim().min(1).max(200),
  kind: tmdbSearchKindSchema,
  year: z.coerce.number().int().min(1870).max(2200).optional(),
  language: z.string().min(2).max(16).optional(),
})
export type TmdbSearchQuery = z.infer<typeof tmdbSearchQuerySchema>

export const tmdbSearchResultSchema = z.object({
  tmdbId: z.number().int(),
  kind: tmdbSearchKindSchema,
  title: z.string(),
  originalTitle: z.string().optional(),
  year: z.number().int().optional(),
  overview: z.string().optional(),
  posterPath: z.string().optional(),
  popularity: z.number().optional(),
})
export type TmdbSearchResult = z.infer<typeof tmdbSearchResultSchema>

export const tmdbSearchResponseSchema = z.object({ items: z.array(tmdbSearchResultSchema) })
export type TmdbSearchResponse = z.infer<typeof tmdbSearchResponseSchema>

export const tmdbPreviewSizeSchema = z.enum(['w185', 'w300'])
export type TmdbPreviewSize = z.infer<typeof tmdbPreviewSizeSchema>

const positive = z.number().int().min(0).max(100_000)

export const assignBodySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('movie'), tmdbId: z.number().int().positive() }),
  z.object({
    kind: z.literal('episode'),
    seriesTmdbId: z.number().int().positive(),
    seasonNumber: positive.optional(),
    episodeNumber: positive.optional(),
  }),
  z.object({ kind: z.literal('series'), tmdbId: z.number().int().positive() }),
])
export type AssignBody = z.infer<typeof assignBodySchema>

export const assignResponseSchema = z.object({
  sourceIds: z.array(z.string()),
  itemIds: z.array(z.string()),
  needsReview: z.array(
    z.object({ sourceId: z.string(), seasonNumber: z.number(), episodeNumber: z.number() }),
  ),
})
export type AssignResponse = z.infer<typeof assignResponseSchema>

export const editableFieldSchema = z.enum([
  'title',
  'year',
  'overview',
  'genres',
  'poster',
  'backdrop',
])
export type EditableField = z.infer<typeof editableFieldSchema>

export const editableImageKindSchema = z.enum(['poster', 'backdrop'])
export type EditableImageKind = z.infer<typeof editableImageKindSchema>

export const itemMetadataDtoSchema = z.object({
  id: z.string(),
  kind: z.enum(['movie', 'series', 'season', 'episode']),
  tmdbId: z.number().int().optional(),
  title: z.string().optional(),
  year: z.number().int().optional(),
  overview: z.string().optional(),
  genres: z.array(genreIdSchema),
  images: z.object({ poster: z.string().optional(), backdrop: z.string().optional() }),
  locked: z.array(editableFieldSchema),
  metadataRefreshedAt: z.string().optional(),
})
export type ItemMetadataDto = z.infer<typeof itemMetadataDtoSchema>

export const updateItemMetadataBodySchema = z
  .object({
    title: z.string().trim().min(1).max(500),
    year: z.number().int().min(1870).max(2200),
    overview: z.string().trim().max(10_000),
    genres: z
      .array(genreIdSchema)
      .max(MAX_ITEM_GENRES)
      .transform((genres) => [...new Set(genres)]),
  })
  .partial()
  .refine((body) => Object.keys(body).length > 0, { message: 'expected at least one field' })
export type UpdateItemMetadataBody = z.infer<typeof updateItemMetadataBodySchema>

export const overrideFieldParamSchema = z.object({ field: editableFieldSchema })
export type OverrideFieldParam = z.infer<typeof overrideFieldParamSchema>

export const imageAlternativesQuerySchema = z.object({ kind: editableImageKindSchema })
export type ImageAlternativesQuery = z.infer<typeof imageAlternativesQuerySchema>

export const imageAlternativeDtoSchema = z.object({
  tmdbPath: z.string(),
  width: z.number().int(),
  height: z.number().int(),
  language: z.string().optional(),
  voteAverage: z.number().optional(),
  current: z.boolean(),
})
export type ImageAlternativeDto = z.infer<typeof imageAlternativeDtoSchema>

export const imageAlternativesResponseSchema = z.object({
  items: z.array(imageAlternativeDtoSchema),
})
export type ImageAlternativesResponse = z.infer<typeof imageAlternativesResponseSchema>

export const maxImageUploadBytes = 10 * 1024 * 1024

export const chooseItemImageBodySchema = z.object({
  kind: editableImageKindSchema,
  tmdbPath: z.string().regex(/^\/[A-Za-z0-9_-]{1,64}\.(jpg|jpeg|png|webp)$/u),
})
export type ChooseItemImageBody = z.infer<typeof chooseItemImageBodySchema>

export const uploadItemImageFormSchema = z.object({
  kind: editableImageKindSchema,
  file: z.instanceof(File),
})
export type UploadItemImageForm = z.infer<typeof uploadItemImageFormSchema>
