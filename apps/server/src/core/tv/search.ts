import { foldLigatures } from '../catalog/search.ts'
import type { TvChannel } from './channel.ts'
import type { TvProgramme } from './guide.ts'

/** The search's TV sections (§29.6): channels and programmes at most. */
export const tvSearchRules = { maxChannels: 10, maxProgrammes: 20 } as const

/**
 * The words of a text as the search reads them (§29.6): ligatures spelled out, accents removed,
 * lowercased, cut into runs of letters and digits.
 */
export const tvSearchWordsOf = (text: string): string[] =>
  foldLigatures(text.normalize('NFC'))
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word !== '')

/**
 * A programme's stored search text (`tv_programmes.search_text`, §29.6): the words of its title
 * and subtitle, each after a space, so `LIKE '% word%'` matches a word's start.
 */
export const tvSearchTextOf = (programme: { title: string; subtitle?: string }): string =>
  [programme.title, programme.subtitle ?? '']
    .flatMap(tvSearchWordsOf)
    .map((word) => ` ${word}`)
    .join('')

/** A query as the TV sections read it: its words, and the channel number it names. */
export type TvSearchQuery = { words: string[]; number?: number }

/**
 * The query's words (§29.6), and its number when it is digits alone. Below 2 characters only a
 * channel number is searched (`words` empty); `undefined` when nothing is.
 */
export const parseTvSearch = (query: string): TvSearchQuery | undefined => {
  const text = query.trim()
  const number = /^\d{1,6}$/u.test(text) ? Number(text) : undefined
  const words = text.length < 2 ? [] : tvSearchWordsOf(text)
  if (words.length === 0 && number === undefined) return undefined
  return { words, ...(number === undefined ? {} : { number }) }
}

/** Whether every query word starts one of `words` (§29.6). */
export const matchesTvSearch = (words: readonly string[], query: readonly string[]): boolean =>
  query.length > 0 && query.every((wanted) => words.some((word) => word.startsWith(wanted)))

/** A channel as the search lists it, in the viewer's order (§29.7). */
export type TvSearchChannel = Pick<TvChannel, 'id' | 'name' | 'number' | 'logoPath'>

/**
 * The matching channels (§29.6), at most `limit`: the channel of the number first, then those
 * whose name starts with the query's first word, then the others, each in `channels`' order.
 */
export const matchTvChannels = <T extends Pick<TvChannel, 'name' | 'number'>>(
  channels: readonly T[],
  query: TvSearchQuery,
  limit: number = tvSearchRules.maxChannels,
): T[] => {
  const ranked: { channel: T; rank: number; index: number }[] = []
  for (const [index, channel] of channels.entries()) {
    const words = tvSearchWordsOf(channel.name)
    const rank =
      query.number !== undefined && channel.number === query.number
        ? 0
        : !matchesTvSearch(words, query.words)
          ? undefined
          : words[0]?.startsWith(query.words[0] ?? '') === true
            ? 1
            : 2
    if (rank !== undefined) ranked.push({ channel, rank, index })
  }
  return ranked
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .slice(0, limit)
    .map(({ channel }) => channel)
}

/** A programme as the search lists it (§29.7): no description, categories nor image. */
export type TvSearchProgramme = Pick<
  TvProgramme,
  'id' | 'channelId' | 'title' | 'subtitle' | 'episode' | 'kind' | 'startAt' | 'endAt'
>

/** What the search reads of the TV (§29.6): only enabled, present channels. */
export type TvSearchReadModel = {
  /** Every enabled, present channel, in the viewer's order (§29.7). */
  viewableChannels: () => TvSearchChannel[]
  /**
   * The programmes of enabled, present channels ending after `at` whose title or subtitle has a
   * word starting with each of `words`, at most `limit`: on now first, then by start, then in
   * the channels' order.
   */
  matchingProgrammes: (input: {
    words: readonly string[]
    at: Date
    limit: number
  }) => TvSearchProgramme[]
}
