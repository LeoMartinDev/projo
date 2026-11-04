import type { ParsedName } from '../naming/index.ts'
import { MAX_EPISODES_PER_FILE } from '../scanner/item-linking.ts'

export type LinkedItemInfo = {
  id: string
  kind: 'movie' | 'series' | 'season' | 'episode'
  tmdbId?: number
  parentId?: string
  seasonNumber?: number
  episodeNumber?: number
}

export const isLocal = (item: LinkedItemInfo): boolean => item.tmdbId === undefined

export const adoptableMovie = (links: readonly LinkedItemInfo[]): string | undefined => {
  const local = links.filter((link) => link.kind === 'movie' && isLocal(link))
  return local.length === 1 ? local[0]?.id : undefined
}

export const pairReplacedItems = (
  previous: readonly LinkedItemInfo[],
  next: readonly { id: string; episodeNumber?: number }[],
  orphaned: ReadonlySet<string> = new Set(),
): { from: string; into: string }[] => {
  const nextIds = new Set(next.map((item) => item.id))
  const first = next[0]
  if (first === undefined) return []
  return previous
    .filter((item) => (isLocal(item) || orphaned.has(item.id)) && !nextIds.has(item.id))
    .map((item) => {
      const same =
        item.episodeNumber === undefined
          ? undefined
          : next.find((candidate) => candidate.episodeNumber === item.episodeNumber)
      return { from: item.id, into: (same ?? first).id }
    })
}

export const episodeSpan = (parsed: ParsedName, first: number): number[] => {
  const start = parsed.episode ?? parsed.absoluteEpisode
  const end = parsed.episode !== undefined ? parsed.episodeEnd : parsed.absoluteEpisodeEnd
  const span = start === undefined || end === undefined || end < start ? 1 : end - start + 1
  const count = span > MAX_EPISODES_PER_FILE ? 1 : span
  return Array.from({ length: count }, (_, i) => first + i)
}
