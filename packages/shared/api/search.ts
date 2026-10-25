import { z } from 'zod'

import { itemSummaryDtoSchema } from './catalog.ts'

/**
 * `GET /search?q=` (§13.5): title and original title of movies and series, accent and case
 * insensitive, every word as a prefix, from 2 characters, 30 results max (both groups together),
 * best match first.
 */
export const searchQuerySchema = z.object({ q: z.string().trim().min(2).max(200) })
export type SearchQuery = z.infer<typeof searchQuerySchema>

export const searchResultsSchema = z.object({
  movies: z.array(itemSummaryDtoSchema),
  series: z.array(itemSummaryDtoSchema),
})
export type SearchResults = z.infer<typeof searchResultsSchema>
