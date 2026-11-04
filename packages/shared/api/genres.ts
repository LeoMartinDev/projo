import { z } from 'zod'

export const genreIds = [
  'action',
  'adventure',
  'animation',
  'comedy',
  'crime',
  'documentary',
  'drama',
  'family',
  'fantasy',
  'history',
  'horror',
  'kids',
  'music',
  'mystery',
  'news',
  'politics',
  'reality',
  'romance',
  'science_fiction',
  'soap',
  'talk',
  'thriller',
  'tv_movie',
  'war',
  'western',
] as const

export const genreIdSchema = z.enum(genreIds)
export type GenreId = z.infer<typeof genreIdSchema>

export const MAX_ITEM_GENRES = genreIds.length
