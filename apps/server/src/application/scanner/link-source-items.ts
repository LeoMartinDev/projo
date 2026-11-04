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
  playbackSessions: PlaybackSessionTerminator
  ids: IdGenerator
  clock: Clock
}

export type LinkOutcome =
  { kind: 'linked'; itemIds: string[]; changed: boolean } | { kind: 'kept' } | { kind: 'none' }

export type LinkSourceInput = LinkableSource & {
  id: string
  matchState: MatchState
  readyAt?: Date
}

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
            playbackSessions.endWithin({ itemIds: pruned })
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
