import type { ParsedName } from '../naming/index.ts'
import { MAX_EPISODES_PER_FILE } from '../scanner/item-linking.ts'

/**
 * From M1 local items to TMDB items without losing anything (§7.6, §9.2). Pure planning; the
 * writes happen in one transaction (`application/metadata/apply-match.ts`).
 *
 * - The TMDB item already exists (another file, another series episode): the source moves to it
 *   and the per-profile rows of its local items (progress, Ma liste, track preferences,
 *   segments…) are merged into it; the emptied local items are pruned.
 * - It does not exist yet: the local item the source was linked to is **adopted**: it gets the
 *   TMDB id and the metadata, its id (and everything pointing at it) stays.
 * - Re-identification ("Fix the match", §7.8): a TMDB item the source leaves without
 *   any file left hands its per-profile rows over too (progress, Ma liste…); one that keeps
 *   another file keeps its history.
 */

export type LinkedItemInfo = {
  id: string
  kind: 'movie' | 'series' | 'season' | 'episode'
  tmdbId?: number
  parentId?: string
  seasonNumber?: number
  episodeNumber?: number
}

/** A local item: created from the file name (M1), no TMDB id. */
export const isLocal = (item: LinkedItemInfo): boolean => item.tmdbId === undefined

/** The local movie a source may hand over to its TMDB movie (exactly one, else none). */
export const adoptableMovie = (links: readonly LinkedItemInfo[]): string | undefined => {
  const local = links.filter((link) => link.kind === 'movie' && isLocal(link))
  return local.length === 1 ? local[0]?.id : undefined
}

/**
 * Pairs each item the source leaves with the item that replaces it: a movie with the movie, an
 * episode with the episode of the same number (else the first one). Paired: local items, and the
 * TMDB items left without any file (`orphaned`, re-identification). Items kept (same id) and TMDB
 * items that keep another file are not paired.
 */
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

/**
 * Episode numbers a file covers once its first episode is known: the span of the name
 * (`S01E01-E03` → 3 episodes) from that episode on.
 */
export const episodeSpan = (parsed: ParsedName, first: number): number[] => {
  const start = parsed.episode ?? parsed.absoluteEpisode
  const end = parsed.episode !== undefined ? parsed.episodeEnd : parsed.absoluteEpisodeEnd
  const span = start === undefined || end === undefined || end < start ? 1 : end - start + 1
  // Same guard as the M1 linking: `S01E01-E40` is a parse accident.
  const count = span > MAX_EPISODES_PER_FILE ? 1 : span
  return Array.from({ length: count }, (_, i) => first + i)
}
