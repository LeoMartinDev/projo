import type { EpisodeRef, VisibilityScope } from '../catalog/catalog.ts'
import { isResumable, type ItemProgress } from './progress.ts'

export const homeRules = { rowLimit: 20 } as const

export type PlayedItem = {
  itemId: string
  kind: 'movie' | 'episode'
  seriesId?: string
  seasonNumber?: number
  episodeNumber?: number
  absent?: true
  progress: ItemProgress
}

export type ProgressQueries = {
  listPlayed: (input: { profileId: string; scope: VisibilityScope }) => PlayedItem[]
}

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

export const regularEpisodes = (episodes: readonly EpisodeRef[]): readonly EpisodeRef[] => {
  const regular = episodes.filter((episode) => episode.seasonNumber !== 0)
  return regular.length > 0 ? regular : episodes
}

type Numbered = { seasonNumber?: number; episodeNumber?: number }

const comesAfter = (episode: Numbered, other: Numbered): boolean => {
  const season = episode.seasonNumber ?? 1_000_000
  const otherSeason = other.seasonNumber ?? 1_000_000
  return (
    season > otherSeason ||
    (season === otherSeason &&
      (episode.episodeNumber ?? 1_000_000) > (other.episodeNumber ?? 1_000_000))
  )
}

export const nextEpisode = (
  episodes: readonly EpisodeRef[],
  progress: ReadonlyMap<string, ItemProgress>,
  absentWatched: readonly (Numbered & { progress: ItemProgress })[] = [],
): EpisodeRef | undefined => {
  const isWatched = (episode: EpisodeRef) => progress.get(episode.id)?.watched === true
  const firstUnwatched = episodes.find((episode) => !isWatched(episode))
  if (firstUnwatched === undefined) return undefined
  let reference: { from: number; at: number } | undefined
  const consider = (from: number, at: number) => {
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

export const upNext = ({
  played,
  episodes,
  hiddenSeries,
  limit = homeRules.rowLimit,
}: {
  played: readonly PlayedItem[]
  episodes: readonly EpisodeRef[]
  hiddenSeries: ReadonlySet<string>
  limit?: number
}): UpNextEntry[] => {
  const episodesBySeries = groupBySeries(episodes)
  const entries: UpNextEntry[] = []
  for (const [seriesId, seriesPlayed] of upNextCandidates(played, hiddenSeries)) {
    const progress = new Map(seriesPlayed.map((entry) => [entry.itemId, entry.progress]))
    const present = regularEpisodes(episodesBySeries.get(seriesId) ?? [])
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
  action: 'resume' | 'play'
  episode: EpisodeRef
  positionMs: number
}

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
