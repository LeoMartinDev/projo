import type { ItemSummaryDto } from '@projo/shared/api/catalog'
import type { SearchChannelDto, SearchProgrammeDto, SearchResults } from '@projo/shared/api/search'

/** A result of the search: a title (§13.5), a channel or a programme (§29.6). */
export type SearchEntry =
  | { kind: 'item'; item: ItemSummaryDto }
  | { kind: 'channel'; channel: SearchChannelDto }
  | { kind: 'programme'; programme: SearchProgrammeDto }

export type SearchSectionId = 'movies' | 'series' | 'channels' | 'programmes'

export type SearchSection = { id: SearchSectionId; entries: readonly SearchEntry[] }

/**
 * The search's sections in their order (§13.5, §29.6): movies, shows, channels, programmes, each
 * possibly empty; a server without the TV's sections gives them empty.
 */
export const searchSections = (results: SearchResults): readonly SearchSection[] => [
  { id: 'movies', entries: results.movies.map((item) => ({ kind: 'item', item })) },
  { id: 'series', entries: results.series.map((item) => ({ kind: 'item', item })) },
  {
    id: 'channels',
    entries: (results.channels ?? []).map((channel) => ({ kind: 'channel', channel })),
  },
  {
    id: 'programmes',
    entries: (results.programmes ?? []).map((programme) => ({ kind: 'programme', programme })),
  },
]

/** Whether a programme is on air at `at` (§29.3: start ≤ at < end). */
export const isOnAir = (programme: Pick<SearchProgrammeDto, 'startAt' | 'endAt'>, at: number) =>
  Date.parse(programme.startAt) <= at && at < Date.parse(programme.endAt)

/** A channel as the TV shows it: its number, then its name (`20 Téva`). */
export const channelLabel = (channel: Pick<SearchChannelDto, 'name' | 'number'>): string =>
  channel.number === undefined ? channel.name : `${channel.number} ${channel.name}`
