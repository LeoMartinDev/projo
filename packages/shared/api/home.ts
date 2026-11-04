import { z } from 'zod'

import {
  type ItemSummaryDto,
  itemPageSchema,
  itemSummaryDtoSchema,
  playTargetDtoSchema,
} from './catalog.ts'
import { paginationQuerySchema } from './common.ts'
import { genreIdSchema } from './genres.ts'

export const homeHeroDtoSchema = z.object({
  item: itemSummaryDtoSchema.extend({
    overview: z.string().optional(),
    genres: z.array(genreIdSchema),
  }),
  episode: itemSummaryDtoSchema.optional(),
  play: playTargetDtoSchema.optional(),
  previewUrl: z.string().optional(),
})
export type HomeHeroDto = z.infer<typeof homeHeroDtoSchema>

export const upNextEntryDtoSchema = z.object({
  episode: itemSummaryDtoSchema,
  isNew: z.boolean(),
})
export type UpNextEntryDto = z.infer<typeof upNextEntryDtoSchema>

export const resumeFrameDtoSchema = z.object({ url: z.string() })
export type ResumeFrameDto = z.infer<typeof resumeFrameDtoSchema>

export const continueWatchingEntryDtoSchema = itemSummaryDtoSchema.extend({
  resumeFrame: resumeFrameDtoSchema.optional(),
})
export type ContinueWatchingEntryDto = z.infer<typeof continueWatchingEntryDtoSchema>

export const homeRowDtoSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('continue_watching'),
    items: z.array(continueWatchingEntryDtoSchema),
  }),
  z.object({ kind: z.literal('up_next'), items: z.array(upNextEntryDtoSchema) }),
  z.object({ kind: z.literal('recently_added'), items: z.array(itemSummaryDtoSchema) }),
  z.object({ kind: z.literal('watchlist'), items: z.array(itemSummaryDtoSchema) }),
])
export type HomeRowDto = z.infer<typeof homeRowDtoSchema>

export const homeDtoSchema = z.object({
  hero: homeHeroDtoSchema.optional(),
  rows: z.array(homeRowDtoSchema),
})
export type HomeDto = z.infer<typeof homeDtoSchema>

export const homeCategoryDtoSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('anime') }),
  z.object({ kind: z.literal('genre'), genre: genreIdSchema }),
])
export type HomeCategoryDto = z.infer<typeof homeCategoryDtoSchema>

export const homeCategoryKey = (category: HomeCategoryDto): string =>
  category.kind === 'anime' ? 'anime' : `genre-${category.genre}`

export const homeCategoryRowDtoSchema = z.object({
  category: homeCategoryDtoSchema,
  items: z.array(itemSummaryDtoSchema),
})
export type HomeCategoryRowDto = z.infer<typeof homeCategoryRowDtoSchema>

export const homeCategoriesQuerySchema = z.object({
  cursor: z
    .string()
    .regex(/^\d{1,4}$/u, 'a cursor is a nextCursor of a previous batch')
    .optional(),
})
export const homeCategoriesDtoSchema = z.object({
  rows: z.array(homeCategoryRowDtoSchema),
  total: z.number().int().min(0),
  nextCursor: z.string().optional(),
})
export type HomeCategoriesDto = z.infer<typeof homeCategoriesDtoSchema>

export const reservedCategoryRows = (pages: readonly HomeCategoriesDto[]): number => {
  const [first] = pages
  const last = pages.at(-1)
  if (first === undefined || last?.nextCursor === undefined) return 0
  const loaded = pages.reduce((sum, page) => sum + page.rows.length, 0)
  return Math.max(0, Math.min(first.rows.length, last.total - loaded))
}

export const recentlyAddedTarget = (
  items: readonly Pick<ItemSummaryDto, 'kind'>[],
): 'movies' | 'series' =>
  items.filter((item) => item.kind === 'series').length > items.length / 2 ? 'series' : 'movies'

export const homeCategorySlugSchema = z.union([z.literal('anime'), genreIdSchema])
export type HomeCategorySlug = z.infer<typeof homeCategorySlugSchema>

export const homeCategorySlug = (category: HomeCategoryDto): HomeCategorySlug =>
  category.kind === 'anime' ? 'anime' : category.genre

export const homeCategoryOfSlug = (slug: HomeCategorySlug): HomeCategoryDto =>
  slug === 'anime' ? { kind: 'anime' } : { kind: 'genre', genre: slug }

export const homeCategoryParamSchema = z.object({ category: homeCategorySlugSchema })

export const homeCategoryPageQuerySchema = paginationQuerySchema.extend({
  cursor: z
    .string()
    .regex(/^\d{1,6}$/u, 'a cursor is a nextCursor of a previous page')
    .optional(),
})
export const homeCategoryPageSchema = itemPageSchema
export type HomeCategoryPage = z.infer<typeof homeCategoryPageSchema>
