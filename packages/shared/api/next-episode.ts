import type { ItemSummaryDto } from './catalog.ts'

type Numbered = Pick<ItemSummaryDto, 'id' | 'seasonNumber' | 'episodeNumber' | 'episodeNumberEnd'>

const byEpisode = (a: Numbered, b: Numbered) => (a.episodeNumber ?? 0) - (b.episodeNumber ?? 0)
const bySeason = (a: Numbered, b: Numbered) => (a.seasonNumber ?? 0) - (b.seasonNumber ?? 0)

export const sortedEpisodes = <T extends Numbered>(episodes: readonly T[]): T[] =>
  [...episodes].sort(byEpisode)

export const sortedSeasons = <T extends Numbered>(seasons: readonly T[]): T[] =>
  [...seasons].sort(bySeason)

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

export const episodeNumberLabel = (episode: Numbered): string | undefined =>
  episode.episodeNumber === undefined
    ? undefined
    : episode.episodeNumberEnd === undefined
      ? String(episode.episodeNumber)
      : `${episode.episodeNumber}-${episode.episodeNumberEnd}`

export const holds = (card: Numbered, episode: Numbered): boolean =>
  card.id === episode.id ||
  (card.episodeNumber !== undefined &&
    card.episodeNumberEnd !== undefined &&
    episode.episodeNumber !== undefined &&
    episode.episodeNumber >= card.episodeNumber &&
    episode.episodeNumber <= card.episodeNumberEnd)

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
