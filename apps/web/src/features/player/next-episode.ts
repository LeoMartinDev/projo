import type { ItemSummaryDto } from '@projo/shared/api/catalog'

/**
 * The episode after the one playing (§10.7 "next episode", `N`): the next one of its season
 * (`GET /items/:season/children`), else the first one of the next season. Specials (season 0)
 * have no next season. A multi-episode file (§8.4, `episodeNumberEnd`) is one card: what it
 * holds is skipped. Pure.
 */
type Numbered = Pick<ItemSummaryDto, 'id' | 'seasonNumber' | 'episodeNumber' | 'episodeNumberEnd'>

const byEpisode = (a: Numbered, b: Numbered) => (a.episodeNumber ?? 0) - (b.episodeNumber ?? 0)
const bySeason = (a: Numbered, b: Numbered) => (a.seasonNumber ?? 0) - (b.seasonNumber ?? 0)

export const sortedEpisodes = <T extends Numbered>(episodes: readonly T[]): T[] =>
  episodes.toSorted(byEpisode)

export const sortedSeasons = <T extends Numbered>(seasons: readonly T[]): T[] =>
  seasons.toSorted(bySeason)

/**
 * The cards of a season, sorted (§8.4): an episode the previous card's file also holds (up to its
 * `episodeNumberEnd`) has none of its own, "E01-E02" is one card.
 */
export const episodeCards = <T extends Numbered>(episodes: readonly T[]): T[] => {
  const cards: T[] = []
  let heldUpTo: number | undefined
  for (const episode of sortedEpisodes(episodes)) {
    const held =
      heldUpTo !== undefined &&
      episode.episodeNumber !== undefined &&
      episode.episodeNumber <= heldUpTo
    if (held) continue
    cards.push(episode)
    heldUpTo = episode.episodeNumberEnd
  }
  return cards
}

/** "4", or "1-2" for a multi-episode file; `undefined` without a number. */
export const episodeNumberLabel = (episode: Numbered): string | undefined =>
  episode.episodeNumber === undefined
    ? undefined
    : episode.episodeNumberEnd === undefined
      ? String(episode.episodeNumber)
      : `${episode.episodeNumber}-${episode.episodeNumberEnd}`

/** The card `episode` is part of: its own, or the one whose file holds it too. */
export const holds = (card: Numbered, episode: Numbered): boolean =>
  card.id === episode.id ||
  (card.episodeNumber !== undefined &&
    card.episodeNumberEnd !== undefined &&
    episode.episodeNumber !== undefined &&
    episode.episodeNumber >= card.episodeNumber &&
    episode.episodeNumber <= card.episodeNumberEnd)

/** `undefined` when the episode (or its file) is the last of its season, or not in the list. */
export const nextInSeason = <T extends Numbered>(
  episodes: readonly T[],
  currentId: string,
): T | undefined => {
  const current = episodes.find((episode) => episode.id === currentId)
  if (current === undefined) return undefined
  const cards = episodeCards(episodes)
  const index = cards.findIndex((card) => holds(card, current))
  return index < 0 ? undefined : cards[index + 1]
}

/** The first season numbered after `seasonNumber`; none after the specials. */
export const nextSeason = <T extends Numbered>(
  seasons: readonly T[],
  seasonNumber: number | undefined,
): T | undefined =>
  seasonNumber === undefined || seasonNumber === 0
    ? undefined
    : sortedSeasons(seasons).find(
        (season) => season.seasonNumber !== undefined && season.seasonNumber > seasonNumber,
      )

export type NextEpisode<T> =
  { status: 'loading' } | { status: 'none' } | { status: 'found'; episode: T }

/**
 * The lists come from three queries, each `undefined` until loaded (and the later ones only
 * fetched when needed): the season's episodes, the series' seasons, the next season's episodes.
 */
export const nextEpisodeOf = <T extends Numbered, S extends Numbered>({
  currentId,
  seasonNumber,
  episodes,
  seasons,
  nextSeasonEpisodes,
}: {
  currentId: string
  seasonNumber: number | undefined
  episodes: readonly T[] | undefined
  seasons: readonly S[] | undefined
  nextSeasonEpisodes: readonly T[] | undefined
}): NextEpisode<T> => {
  if (episodes === undefined) return { status: 'loading' }
  const inSeason = nextInSeason(episodes, currentId)
  if (inSeason !== undefined) return { status: 'found', episode: inSeason }
  if (seasons === undefined) return { status: 'loading' }
  if (nextSeason(seasons, seasonNumber) === undefined) return { status: 'none' }
  if (nextSeasonEpisodes === undefined) return { status: 'loading' }
  const first = episodeCards(nextSeasonEpisodes)[0]
  return first === undefined ? { status: 'none' } : { status: 'found', episode: first }
}
