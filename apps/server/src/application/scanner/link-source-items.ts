import type { Clock } from '../../core/clock.ts'
import type { IdGenerator } from '../../core/ids.ts'
import { pairReplacedItems } from '../../core/metadata/linking.ts'
import type { PlaybackSessionTerminator } from '../../core/playback/session.ts'
import {
  type EpisodeTarget,
  episodeTitle,
  type LinkedItem,
  type LinkTarget,
  linkTargetsFor,
  type LocalItemRepository,
  pickLocalCandidate,
  sortTitleOf,
} from '../../core/scanner/item-linking.ts'
import type { MatchState } from '../../core/source/source.ts'
import type { LinkableSource } from '../../core/scanner/item-linking.ts'

type Deps = {
  localItems: LocalItemRepository
  /** Sessions on a pruned item are ended before it goes (§10.6). */
  playbackSessions: PlaybackSessionTerminator
  ids: IdGenerator
  clock: Clock
}

export type LinkOutcome =
  | { kind: 'linked'; itemIds: string[]; changed: boolean }
  /** Matched by TMDB or by hand (M2): never touched by the local grouping. */
  | { kind: 'kept' }
  /** Nothing to link (`unknown`, date-based…): waits in "To review" (§7.8). */
  | { kind: 'none' }

export type LinkSourceInput = LinkableSource & {
  id: string
  matchState: MatchState
  /** `added_at` of new items (§6.3: first ready source). */
  readyAt?: Date
}

/**
 * M1 "matching": links a ready source to local items built from its parse (see
 * `core/scanner/item-linking.ts`). Idempotent; a source already linked to the same items keeps
 * them (§7.3: a replaced file comes back to its place without re-matching).
 */
export const linkSourceItemsFactory = ({ localItems, playbackSessions, ids, clock }: Deps) => {
  const create = (item: Parameters<LocalItemRepository['create']>[0]): string => {
    localItems.create(item)
    return item.id
  }

  const rootItem = (kind: 'movie' | 'series', title: string, year: number | undefined): string => {
    const sortTitle = sortTitleOf(title)
    const found = pickLocalCandidate(localItems.findLocalRoots({ kind, sortTitle }), year)
    if (found !== undefined) {
      if (year !== undefined && found.year === undefined) localItems.setYear({ id: found.id, year })
      return found.id
    }
    return create({
      id: ids.next(),
      kind,
      title,
      sortTitle,
      ...(year === undefined ? {} : { year }),
      createdAt: clock.now(),
    })
  }

  /** A linked item, with its season and series for an episode. */
  type Linked = { id: string; episodeNumber?: number; ancestors: string[] }

  const episodeItem = (target: EpisodeTarget): Linked => {
    const title = episodeTitle(target)
    const seriesId = rootItem('series', target.series.title, target.series.year)
    const seasonId =
      localItems.findChild({ parentId: seriesId, kind: 'season', number: target.seasonNumber }) ??
      create({
        id: ids.next(),
        kind: 'season',
        parentId: seriesId,
        sortTitle: String(target.seasonNumber).padStart(4, '0'),
        seasonNumber: target.seasonNumber,
        createdAt: clock.now(),
      })
    const id =
      localItems.findChild({ parentId: seasonId, kind: 'episode', number: target.episodeNumber }) ??
      create({
        id: ids.next(),
        kind: 'episode',
        parentId: seasonId,
        ...(title === undefined ? {} : { title }),
        sortTitle: String(target.episodeNumber).padStart(5, '0'),
        seasonNumber: target.seasonNumber,
        episodeNumber: target.episodeNumber,
        createdAt: clock.now(),
      })
    return { id, episodeNumber: target.episodeNumber, ancestors: [seasonId, seriesId] }
  }

  const itemFor = (target: LinkTarget): Linked =>
    target.kind === 'movie'
      ? { id: rootItem('movie', target.title, target.year), ancestors: [] }
      : episodeItem(target)

  /**
   * §7.6: each item the source leaves, and its season and series, → the item replacing it, so
   * that progress, My list… follow a renamed file instead of going with the pruned item.
   */
  const replacementsOf = (current: LinkedItem[], linked: Linked[]): Map<string, string> => {
    const replacements = new Map<string, string>()
    const previous = current.map(({ itemId, kind, tmdbId, episodeNumber }) => ({
      id: itemId,
      kind,
      ...(tmdbId === undefined ? {} : { tmdbId }),
      ...(episodeNumber === undefined ? {} : { episodeNumber }),
    }))
    for (const { from, into } of pairReplacedItems(previous, linked)) {
      replacements.set(from, into)
      const season = localItems.parentOf(from)
      const series = season === undefined ? undefined : localItems.parentOf(season)
      const [nextSeason, nextSeries] = linked.find((item) => item.id === into)?.ancestors ?? []
      for (const [ancestor, target] of [
        [season, nextSeason],
        [series, nextSeries],
      ] as const) {
        if (ancestor !== undefined && target !== undefined && ancestor !== target)
          replacements.set(ancestor, target)
      }
    }
    return replacements
  }

  return (source: LinkSourceInput): LinkOutcome =>
    localItems.transaction(() => {
      if (source.matchState === 'matched' || source.matchState === 'manual') return { kind: 'kept' }
      const current = localItems.linksOf(source.id)
      // TMDB links of the source's kind wait for the matcher; a source re-read as the other kind
      // (§7.4) goes back to local items of its new reading.
      const sameKind = current.every(
        (link) => (link.kind === 'movie') === (source.classification === 'movie'),
      )
      if (sameKind && current.some((link) => link.tmdbId !== undefined)) return { kind: 'kept' }
      const targets = linkTargetsFor(source)
      if (targets.length === 0 && current.length === 0) return { kind: 'none' }
      const linked = targets.map(itemFor)
      const itemIds = [...new Set(linked.map((item) => item.id))]
      const currentIds = current.map((link) => link.itemId)
      const changed =
        itemIds.length !== currentIds.length || itemIds.some((id) => !currentIds.includes(id))
      if (changed) {
        localItems.replaceLinks({ sourceId: source.id, itemIds })
        const replacements = replacementsOf(current, linked)
        localItems.pruneOrphans(
          currentIds.filter((id) => !itemIds.includes(id)),
          (pruned) => {
            // Their sessions end first (§10.6), while they still point at the pruned items.
            playbackSessions.endWithin({ itemIds: pruned })
            // Only the items that go hand their rows over: one that keeps a file keeps them.
            for (const from of pruned) {
              const into = replacements.get(from)
              if (into !== undefined) localItems.moveItemRows({ from, into })
            }
          },
        )
      }
      if (itemIds.length > 0) localItems.markAdded({ itemIds, at: source.readyAt ?? clock.now() })
      return targets.length === 0 ? { kind: 'none' } : { kind: 'linked', itemIds, changed }
    })
}

export type LinkSourceItems = ReturnType<typeof linkSourceItemsFactory>
