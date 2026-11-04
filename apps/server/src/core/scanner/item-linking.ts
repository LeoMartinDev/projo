import { ownTitle } from '../catalog/generic-titles.ts'
import {
  type Classification,
  normalizeTitle,
  type ParsedName,
  unstackedTitle,
} from '../naming/index.ts'

export type MovieTarget = { kind: 'movie'; title: string; year?: number }
export type EpisodeTarget = {
  kind: 'episode'
  series: { title: string; year?: number }
  seasonNumber: number
  episodeNumber: number
  episodeTitle?: string
}
export type LinkTarget = MovieTarget | EpisodeTarget

export const MAX_EPISODES_PER_FILE = 12

export type LinkableSource = {
  classification: Classification
  parsed: ParsedName
  stackGroupId?: string
}

const withYear = (year: number | undefined) => (year === undefined ? {} : { year })

const range = (start: number, end: number | undefined): number[] => {
  const last = end !== undefined && end >= start ? end : start
  if (last - start + 1 > MAX_EPISODES_PER_FILE) return [start]
  return Array.from({ length: last - start + 1 }, (_, i) => start + i)
}

export const linkTargetsFor = ({
  classification,
  parsed,
  stackGroupId,
}: LinkableSource): LinkTarget[] => {
  if (classification === 'movie') {
    if (parsed.title === undefined || parsed.title === '') return []
    const title =
      parsed.part !== undefined && stackGroupId === undefined
        ? unstackedTitle(parsed.title, parsed.part)
        : parsed.title
    return [{ kind: 'movie', title, ...withYear(parsed.year) }]
  }
  if (classification !== 'episode') return []
  const seriesTitle = parsed.series
  if (seriesTitle === undefined || seriesTitle === '') return []
  const numbers =
    parsed.episode !== undefined
      ? range(parsed.episode, parsed.episodeEnd)
      : parsed.absoluteEpisode !== undefined
        ? range(parsed.absoluteEpisode, parsed.absoluteEpisodeEnd)
        : []
  const seasonNumber = parsed.season ?? 1
  return numbers.map((episodeNumber) => ({
    kind: 'episode',
    series: { title: seriesTitle, ...withYear(parsed.year) },
    seasonNumber,
    episodeNumber,
    ...(parsed.episodeTitle === undefined ? {} : { episodeTitle: parsed.episodeTitle }),
  }))
}

export const sortTitleOf = (title: string): string => normalizeTitle(title)

export type LocalCandidate = { id: string; year?: number }

export const pickLocalCandidate = (
  candidates: readonly LocalCandidate[],
  year: number | undefined,
): LocalCandidate | undefined => {
  if (year !== undefined) {
    return candidates.find((c) => c.year === year) ?? candidates.find((c) => c.year === undefined)
  }
  return (
    candidates.find((c) => c.year === undefined) ??
    (candidates.length === 1 ? candidates[0] : undefined)
  )
}

export const episodeTitle = (target: EpisodeTarget): string | undefined =>
  ownTitle({ kind: 'episode', title: target.episodeTitle, episodeNumber: target.episodeNumber })

export type LocalItemKind = 'movie' | 'series' | 'season' | 'episode'

export type NewLocalItem = {
  id: string
  kind: LocalItemKind
  parentId?: string
  title?: string
  sortTitle: string
  year?: number
  seasonNumber?: number
  episodeNumber?: number
  createdAt: Date
}

export type LinkedItem = {
  itemId: string
  kind: LocalItemKind
  tmdbId?: number
  episodeNumber?: number
}

export type LocalItemRepository = {
  transaction: <T>(run: () => T) => T
  linksOf: (sourceId: string) => LinkedItem[]
  parentOf: (id: string) => string | undefined
  moveItemRows: (input: { from: string; into: string }) => void
  findLocalRoots: (input: { kind: 'movie' | 'series'; sortTitle: string }) => LocalCandidate[]
  findChild: (input: {
    parentId: string
    kind: 'season' | 'episode'
    number: number
  }) => string | undefined
  create: (item: NewLocalItem) => void
  setYear: (input: { id: string; year: number }) => void
  replaceLinks: (input: { sourceId: string; itemIds: string[] }) => void
  markAdded: (input: { itemIds: string[]; at: Date }) => void
  pruneOrphans: (itemIds: string[], beforeDelete: (itemIds: string[]) => void) => void
  itemIdsOfLibrary: (libraryId: string) => string[]
}
