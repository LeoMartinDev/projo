import { z } from 'zod'

import { itemSummaryDtoSchema } from './catalog.ts'
import { isoDateTimeSchema } from './common.ts'
import { tvEpisodeDtoSchema, tvProgrammeKindSchema } from './tv.ts'

/**
 * Whether a query is searched (§13.5, §29.6): 2 characters or more, or a single digit (a channel
 * number, which finds no title nor programme).
 */
export const isSearchable = (q: string): boolean => {
  const text = q.trim()
  return text.length >= 2 || /^\d$/u.test(text)
}

export const searchQuerySchema = z.object({
  q: z.string().trim().max(200).refine(isSearchable, { message: 'too short' }),
})
export type SearchQuery = z.infer<typeof searchQuerySchema>

/** A channel of the search (§29.7); `logoUrl` a server path (media key accepted). */
export const searchChannelDtoSchema = z.object({
  id: z.string(),
  name: z.string(),
  number: z.number().int().optional(),
  logoUrl: z.string().optional(),
})
export type SearchChannelDto = z.infer<typeof searchChannelDtoSchema>

/** A programme of the search (§29.7), with its channel: its detail is `GET /tv/programmes/:id`. */
export const searchProgrammeDtoSchema = z.object({
  id: z.string(),
  title: z.string(),
  subtitle: z.string().optional(),
  episode: tvEpisodeDtoSchema.optional(),
  kind: tvProgrammeKindSchema,
  startAt: isoDateTimeSchema,
  endAt: isoDateTimeSchema,
  channel: searchChannelDtoSchema,
})
export type SearchProgrammeDto = z.infer<typeof searchProgrammeDtoSchema>

/** `GET /search` (§13.5); `channels` and `programmes` (§29.7) absent from older servers. */
export const searchResultsSchema = z.object({
  movies: z.array(itemSummaryDtoSchema),
  series: z.array(itemSummaryDtoSchema),
  channels: z.array(searchChannelDtoSchema).optional(),
  programmes: z.array(searchProgrammeDtoSchema).optional(),
})
export type SearchResults = z.infer<typeof searchResultsSchema>
