import { z } from 'zod'

import { itemSummaryDtoSchema } from './catalog.ts'

export const searchQuerySchema = z.object({ q: z.string().trim().min(2).max(200) })
export type SearchQuery = z.infer<typeof searchQuerySchema>

export const searchResultsSchema = z.object({
  movies: z.array(itemSummaryDtoSchema),
  series: z.array(itemSummaryDtoSchema),
})
export type SearchResults = z.infer<typeof searchResultsSchema>
