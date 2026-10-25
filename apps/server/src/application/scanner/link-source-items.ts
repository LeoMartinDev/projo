import type { Clock } from '../../core/clock.ts'
import type { IdGenerator } from '../../core/ids.ts'
import type { PlaybackSessionTerminator } from '../../core/playback/session.ts'
import {
  type EpisodeTarget,
  episodeTitle,
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

  const episodeItem = (target: EpisodeTarget): string => {
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
    return (
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
    )
  }

  const itemFor = (target: LinkTarget): string =>
    target.kind === 'movie' ? rootItem('movie', target.title, target.year) : episodeItem(target)

  return (source: LinkSourceInput): LinkOutcome =>
    localItems.transaction(() => {
      if (source.matchState === 'matched' || source.matchState === 'manual') return { kind: 'kept' }
      const current = localItems.linksOf(source.id)
      if (current.some((link) => link.tmdbId !== undefined)) return { kind: 'kept' }
      const targets = linkTargetsFor(source)
      if (targets.length === 0 && current.length === 0) return { kind: 'none' }
      const itemIds = [...new Set(targets.map(itemFor))]
      const currentIds = current.map((link) => link.itemId)
      const changed =
        itemIds.length !== currentIds.length || itemIds.some((id) => !currentIds.includes(id))
      if (changed) {
        localItems.replaceLinks({ sourceId: source.id, itemIds })
        localItems.pruneOrphans(
          currentIds.filter((id) => !itemIds.includes(id)),
          (pruned) => playbackSessions.endWithin({ itemIds: pruned }),
        )
      }
      if (itemIds.length > 0) localItems.markAdded({ itemIds, at: source.readyAt ?? clock.now() })
      return targets.length === 0 ? { kind: 'none' } : { kind: 'linked', itemIds, changed }
    })
}

export type LinkSourceItems = ReturnType<typeof linkSourceItemsFactory>
