import type { EpisodeRef, VisibilityScope } from '../catalog/catalog.ts'
import { isResumable, type ItemProgress } from './progress.ts'

/**
 * §13.1 / §13.3 rows of the home screen, computed from the progress of a profile: "Continue
 * watching", "Up next", the hero, and the "Resume S2 · E4" of a series.
 */

export const homeRules = { rowLimit: 20 } as const

/** A visible movie or episode the profile has a progress row on (or an `absent` episode). */
export type PlayedItem = {
  itemId: string
  kind: 'movie' | 'episode'
  /** Episodes: their series. */
  seriesId?: string
  /** Episodes: their numbers, which place them in broadcast order once their files are gone. */
  seasonNumber?: number
  episodeNumber?: number
  /**
   * An episode whose files are gone, of a series still visible: it keeps the show started
   * (§13.1, "Up next" goes on after it) but is never offered itself.
   */
  absent?: true
  progress: ItemProgress
}

/** Reads behind the home rows. */
export type ProgressQueries = {
  listPlayed: (input: { profileId: string; scope: VisibilityScope }) => PlayedItem[]
}

/**
 * "Continue watching": movies and episodes in progress (2 % to 93 %), not removed by the
 * profile (on the item, or on its series), most recently played first.
 */
export const continueWatching = ({
  played,
  hiddenSeries,
  limit = homeRules.rowLimit,
}: {
  played: readonly PlayedItem[]
  hiddenSeries: ReadonlySet<string>
  limit?: number
}): PlayedItem[] =>
  played
    .filter(
      (entry) =>
        entry.absent !== true &&
        isResumable(entry.progress) &&
        !entry.progress.hiddenFromContinue &&
        (entry.seriesId === undefined || !hiddenSeries.has(entry.seriesId)),
    )
    .sort((a, b) => b.progress.lastPlayedAt.getTime() - a.progress.lastPlayedAt.getTime())
    .slice(0, limit)

/**
 * Specials (season 0) are left out of "Up next", "Resume" and the series counts when a series has
 * others (§13.1).
 */
export const regularEpisodes = (episodes: readonly EpisodeRef[]): readonly EpisodeRef[] => {
  const regular = episodes.filter((episode) => episode.seasonNumber !== 0)
  return regular.length > 0 ? regular : episodes
}

type Numbered = { seasonNumber?: number; episodeNumber?: number }

/** Broadcast order of `listSeriesEpisodes`: unnumbered last. */
const comesAfter = (episode: Numbered, other: Numbered): boolean => {
  const season = episode.seasonNumber ?? 1_000_000
  const otherSeason = other.seasonNumber ?? 1_000_000
  return (
    season > otherSeason ||
    (season === otherSeason &&
      (episode.episodeNumber ?? 1_000_000) > (other.episodeNumber ?? 1_000_000))
  )
}

/**
 * §13.1 "Up next": the first episode not watched after the one watched last, in broadcast order
 * (`episodes` holds only present episodes: absent ones are skipped by construction), else the
 * first episode not watched of the series; never an episode already watched. Every episode
 * watched: `undefined`. The episode watched last may be one whose files are gone (`absentWatched`,
 * placed by its numbers): a deleted season 1 still leads to season 2.
 */
export const nextEpisode = (
  episodes: readonly EpisodeRef[],
  progress: ReadonlyMap<string, ItemProgress>,
  absentWatched: readonly (Numbered & { progress: ItemProgress })[] = [],
): EpisodeRef | undefined => {
  const isWatched = (episode: EpisodeRef) => progress.get(episode.id)?.watched === true
  const firstUnwatched = episodes.find((episode) => !isWatched(episode))
  if (firstUnwatched === undefined) return undefined
  // `from`: where the search starts, just after the episode watched last.
  let reference: { from: number; at: number } | undefined
  const consider = (from: number, at: number) => {
    // Ties (a whole season marked at once): the latest in broadcast order.
    if (
      reference === undefined ||
      at > reference.at ||
      (at === reference.at && from >= reference.from)
    )
      reference = { from, at }
  }
  episodes.forEach((episode, index) => {
    const entry = progress.get(episode.id)
    if (entry?.watched === true) consider(index + 1, entry.lastPlayedAt.getTime())
  })
  const lastAbsent = absentWatched
    .filter((entry) => entry.progress.watched)
    .reduce<(Numbered & { progress: ItemProgress }) | undefined>(
      (last, entry) =>
        last === undefined ||
        entry.progress.lastPlayedAt.getTime() > last.progress.lastPlayedAt.getTime() ||
        (entry.progress.lastPlayedAt.getTime() === last.progress.lastPlayedAt.getTime() &&
          comesAfter(entry, last))
          ? entry
          : last,
      undefined,
    )
  if (lastAbsent !== undefined) {
    const from = episodes.findIndex((episode) => comesAfter(episode, lastAbsent))
    consider(from === -1 ? episodes.length : from, lastAbsent.progress.lastPlayedAt.getTime())
  }
  if (reference === undefined) return firstUnwatched
  return episodes.slice(reference.from).find((episode) => !isWatched(episode)) ?? firstUnwatched
}

export type UpNextEntry = {
  seriesId: string
  episode: EpisodeRef
  /** "New episode": its file arrived after the last play on the series. */
  isNew: boolean
  lastActivityAt: Date
}

const groupBySeries = <T extends { seriesId?: string }>(values: readonly T[]) => {
  const groups = new Map<string, T[]>()
  for (const value of values) {
    if (value.seriesId === undefined) continue
    const group = groups.get(value.seriesId) ?? []
    group.push(value)
    groups.set(value.seriesId, group)
  }
  return groups
}

/**
 * "Up next" candidates, in order of first appearance in `played`: series with a watched episode
 * (present or not), none in progress among the present ones, not removed by the profile, with
 * their played episodes. Linear in `played`.
 */
export const upNextCandidates = (
  played: readonly PlayedItem[],
  hiddenSeries: ReadonlySet<string>,
): Map<string, PlayedItem[]> => {
  const groups = groupBySeries(played)
  for (const [seriesId, seriesPlayed] of groups) {
    if (
      hiddenSeries.has(seriesId) ||
      !seriesPlayed.some((entry) => entry.progress.watched) ||
      seriesPlayed.some((entry) => entry.absent !== true && isResumable(entry.progress))
    )
      groups.delete(seriesId)
  }
  return groups
}

/**
 * "Up next": for each series with a watched episode and none in progress, the next episode
 * (`nextEpisode`); a series whose present episodes are all watched, or removed by the profile,
 * leaves the row. Most recent activity on the series first.
 */
export const upNext = ({
  played,
  episodes,
  hiddenSeries,
  limit = homeRules.rowLimit,
}: {
  played: readonly PlayedItem[]
  /** Visible episodes of the played series, in broadcast order. */
  episodes: readonly EpisodeRef[]
  hiddenSeries: ReadonlySet<string>
  limit?: number
}): UpNextEntry[] => {
  const episodesBySeries = groupBySeries(episodes)
  const entries: UpNextEntry[] = []
  for (const [seriesId, seriesPlayed] of upNextCandidates(played, hiddenSeries)) {
    const progress = new Map(seriesPlayed.map((entry) => [entry.itemId, entry.progress]))
    const present = regularEpisodes(episodesBySeries.get(seriesId) ?? [])
    // Specials left out of the present episodes are left out of the absent ones too.
    const withSpecials = present.every((episode) => episode.seasonNumber === 0)
    const next = nextEpisode(
      present,
      progress,
      seriesPlayed.filter(
        (entry) => entry.absent === true && (withSpecials || entry.seasonNumber !== 0),
      ),
    )
    if (next === undefined) continue
    const lastActivityAt = new Date(
      Math.max(...seriesPlayed.map((entry) => entry.progress.lastPlayedAt.getTime())),
    )
    entries.push({
      seriesId,
      episode: next,
      isNew: next.addedAt !== undefined && next.addedAt.getTime() > lastActivityAt.getTime(),
      lastActivityAt,
    })
  }
  return entries
    .sort((a, b) => b.lastActivityAt.getTime() - a.lastActivityAt.getTime())
    .slice(0, limit)
}

export type SeriesPlayTarget = {
  /** `resume`: "Resume S2 · E4"; `play`: "Play" (from the start of the episode). */
  action: 'resume' | 'play'
  episode: EpisodeRef
  positionMs: number
}

/**
 * The main button of a series (§13.5) or of its hero: the episode in progress played last, else
 * the next one (same rule as "Up next"), else — everything watched — the first episode.
 */
export const seriesPlayTarget = (
  episodes: readonly EpisodeRef[],
  progress: ReadonlyMap<string, ItemProgress>,
): SeriesPlayTarget | undefined => {
  const inProgress = episodes
    .flatMap((episode) => {
      const entry = progress.get(episode.id)
      return entry !== undefined && isResumable(entry) ? [{ episode, entry }] : []
    })
    .sort((a, b) => b.entry.lastPlayedAt.getTime() - a.entry.lastPlayedAt.getTime())[0]
  if (inProgress !== undefined) {
    return {
      action: 'resume',
      episode: inProgress.episode,
      positionMs: inProgress.entry.positionMs,
    }
  }
  const regular = regularEpisodes(episodes)
  const next = nextEpisode(regular, progress) ?? regular[0]
  return next === undefined ? undefined : { action: 'play', episode: next, positionMs: 0 }
}

export type HeroPick =
  | { kind: 'continue'; entry: PlayedItem }
  | { kind: 'up_next'; entry: UpNextEntry }
  | { kind: 'recent'; itemId: string }

/** §13.3 hero: the most recent of "Continuer" and "Up next", else the latest addition. */
export const pickHero = ({
  continueRow,
  upNextRow,
  recentlyAddedIds,
}: {
  continueRow: readonly PlayedItem[]
  upNextRow: readonly UpNextEntry[]
  recentlyAddedIds: readonly string[]
}): HeroPick | undefined => {
  const resume = continueRow[0]
  const next = upNextRow[0]
  if (resume !== undefined && next !== undefined) {
    return resume.progress.lastPlayedAt.getTime() >= next.lastActivityAt.getTime()
      ? { kind: 'continue', entry: resume }
      : { kind: 'up_next', entry: next }
  }
  if (resume !== undefined) return { kind: 'continue', entry: resume }
  if (next !== undefined) return { kind: 'up_next', entry: next }
  const recent = recentlyAddedIds[0]
  return recent === undefined ? undefined : { kind: 'recent', itemId: recent }
}

/**
 * "Remove" (§13.1): `hidden_from_continue` on a movie, or on a series for its episodes in both
 * rows. The flag goes at the next play (`applyPosition`, `showAncestorsAgain`).
 */
export const hideFromContinue = (
  previous: ItemProgress | undefined,
  { profileId, itemId, at }: { profileId: string; itemId: string; at: Date },
): ItemProgress =>
  previous === undefined
    ? {
        profileId,
        itemId,
        positionMs: 0,
        durationMs: 0,
        watched: false,
        playCount: 0,
        lastPlayedAt: at,
        hiddenFromContinue: true,
      }
    : { ...previous, hiddenFromContinue: true }
