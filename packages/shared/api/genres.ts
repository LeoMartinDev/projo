import { z } from 'zod'

/**
 * §9.1 genres: projo's own stable ids, the only thing stored (`items.genres`, `item_overrides`)
 * and sent by the API. TMDB genre ids are converted on the server (`core/metadata/genres.ts`);
 * the label comes from the web locales (`genres.<id>`), in the interface language.
 */
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

/** At most this many genres on an item (admin edit, §9.3). */
export const MAX_ITEM_GENRES = genreIds.length
