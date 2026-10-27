import type { Clock } from '../../core/clock.ts'
import type { IdGenerator } from '../../core/ids.ts'
import type { ItemOverrideRepository } from '../../core/metadata/editing.ts'
import {
  episodeMetadata,
  type ItemMetadata,
  movieMetadata,
  type PersonCredit,
  seasonMetadata,
  selectPeople,
  seriesMetadata,
  withoutLocked,
} from '../../core/metadata/enrichment.ts'
import {
  adoptableMovie,
  isLocal,
  type LinkedItemInfo,
  pairReplacedItems,
} from '../../core/metadata/linking.ts'
import type { ItemKind, MetadataItemRepository } from '../../core/metadata/ports.ts'
import type { PlaybackSessionTerminator } from '../../core/playback/session.ts'
import { sortTitleOf } from '../../core/scanner/item-linking.ts'
import type { SourceRepository } from '../../core/source/source.ts'
import type { Resolution, TmdbReviewReason } from './resolve-match.ts'

type Deps = {
  items: MetadataItemRepository
  overrides: Pick<ItemOverrideRepository, 'get' | 'set'>
  sourceRepository: Pick<SourceRepository, 'patch'>
  playbackSessions: PlaybackSessionTerminator
  ids: IdGenerator
  clock: Clock
}

export type AppliedMatch = {
  /** Items the source is now linked to. */
  itemIds: string[]
  /** Items whose metadata was written: their images are fetched next (`fetch_images`). */
  enriched: string[]
  /** The movie or the series written (§9.1: its whole tree follows one library). */
  topLevelId: string
}

type Matched = Exclude<Resolution, { kind: 'review' }>

/**
 * Writes an identification (§9.2 step 3, §9.1) in one transaction: TMDB items found or created
 * (series → season → episode, never an episode without file), metadata written except locked
 * fields (§9.3), cast and crew, then the source moves from its local items to the TMDB ones
 * without losing per-profile rows (see `core/metadata/linking.ts`).
 */
export const applyMatchFactory = ({
  items,
  overrides,
  sourceRepository,
  playbackSessions,
  ids,
  clock,
}: Deps) => {
  // The edits that moved are locks on the target: their values replace TMDB's (§9.3).
  const moveItemRows = (pair: { from: string; into: string }) => {
    items.moveItemRows(pair)
    overrides.set({ itemId: pair.into, overrides: overrides.get(pair.into), at: clock.now() })
  }

  const write = (id: string, metadata: ItemMetadata, language: string) =>
    items.writeMetadata({
      id,
      patch: withoutLocked(metadata, items.lockedFields(id)),
      language,
      refreshedAt: clock.now(),
    })

  const create = (input: {
    kind: ItemKind
    tmdbId: number
    title: string | undefined
    parentId?: string
    seasonNumber?: number
    episodeNumber?: number
  }): string => {
    const id = ids.next()
    const { title, ...rest } = input
    items.create({
      ...rest,
      ...(title === undefined ? {} : { title }),
      id,
      sortTitle: sortTitleOf(title ?? ''),
      createdAt: clock.now(),
    })
    return id
  }

  const people = (itemId: string, credits: PersonCredit[]) =>
    items.replacePeople({ itemId, people: credits, newId: () => ids.next() })

  /** The TMDB top-level item, else the local one adopted, else a new one. */
  const topLevel = (
    kind: 'movie' | 'series',
    tmdbId: number,
    title: string,
    adoptable?: string,
  ) => {
    const existing = items.findByTmdb({ kind, tmdbId })
    if (existing !== undefined) return existing
    if (adoptable !== undefined) {
      items.setTmdbId({ id: adoptable, tmdbId })
      return adoptable
    }
    return create({ kind, tmdbId, title })
  }

  const child = (
    kind: 'season' | 'episode',
    parentId: string,
    number: number,
    tmdbId: number,
    title: string | undefined,
    seasonNumber: number,
  ): string => {
    const found = items.findChild({ parentId, kind, number })
    if (found !== undefined) {
      if (items.findItem(found)?.tmdbId !== tmdbId) items.setTmdbId({ id: found, tmdbId })
      return found
    }
    return create({
      kind,
      tmdbId,
      title,
      parentId,
      seasonNumber,
      ...(kind === 'episode' ? { episodeNumber: number } : {}),
    })
  }

  /** The local series above a local episode the source was linked to (adoption candidate). */
  const localSeriesOf = (links: readonly LinkedItemInfo[]): string | undefined => {
    for (const link of links) {
      if (link.kind !== 'episode' || !isLocal(link) || link.parentId === undefined) continue
      const season = items.findItem(link.parentId)
      const series = season?.parentId === undefined ? undefined : items.findItem(season.parentId)
      if (series !== undefined && series.kind === 'series' && isLocal(series)) return series.id
    }
    return undefined
  }

  const ancestorsOf = (item: LinkedItemInfo): { season?: string; series?: string } => {
    if (item.kind !== 'episode' || item.parentId === undefined) return {}
    const season = items.findItem(item.parentId)
    return {
      ...(season === undefined ? {} : { season: season.id }),
      ...(season?.parentId === undefined ? {} : { series: season.parentId }),
    }
  }

  const writeMatched = (
    resolution: Matched,
    links: readonly LinkedItemInfo[],
    { language, ratingCountry }: { language: string; ratingCountry: string },
  ): {
    targets: { id: string; episodeNumber?: number }[]
    enriched: string[]
    topLevelId: string
    parents?: { season: string; series: string }
  } => {
    if (resolution.kind === 'movie') {
      const { movie } = resolution
      const id = topLevel('movie', movie.tmdbId, movie.title, adoptableMovie(links))
      write(id, movieMetadata(movie, ratingCountry), language)
      people(id, selectPeople(movie.credits))
      return { targets: [{ id }], enriched: [id], topLevelId: id }
    }
    const { series, season, episodes } = resolution
    const seriesId = topLevel('series', series.tmdbId, series.title, localSeriesOf(links))
    const seriesMeta = seriesMetadata(series, ratingCountry)
    write(seriesId, seriesMeta, language)
    people(seriesId, selectPeople(series.credits, series.createdBy))
    const inherited = {
      genres: seriesMeta.genres,
      ...(seriesMeta.contentRating === undefined
        ? {}
        : { contentRating: seriesMeta.contentRating }),
      ...(seriesMeta.contentRatingCountry === undefined
        ? {}
        : { contentRatingCountry: seriesMeta.contentRatingCountry }),
      ...(seriesMeta.originalLanguage === undefined
        ? {}
        : { originalLanguage: seriesMeta.originalLanguage }),
    }
    const seasonMeta = seasonMetadata(season, inherited)
    const seasonId = child(
      'season',
      seriesId,
      season.seasonNumber,
      season.tmdbId,
      seasonMeta.title,
      season.seasonNumber,
    )
    write(seasonId, seasonMeta, language)
    const targets = episodes.map((episode) => {
      const meta = episodeMetadata(episode, inherited)
      const id = child(
        'episode',
        seasonId,
        episode.episodeNumber,
        episode.tmdbId,
        meta.title,
        season.seasonNumber,
      )
      write(id, meta, language)
      return { id, episodeNumber: episode.episodeNumber }
    })
    return {
      targets,
      enriched: [seriesId, seasonId, ...targets.map((t) => t.id)],
      topLevelId: seriesId,
      parents: { season: seasonId, series: seriesId },
    }
  }

  return {
    apply: (input: {
      source: { id: string; readyAt?: Date }
      resolution: Matched
      /** Language the resolution was fetched in (`metadata_language`, §9.1). */
      language: string
      ratingCountry: string
      state: 'matched' | 'manual'
    }): AppliedMatch =>
      items.transaction(() => {
        const links = items.linkedItems(input.source.id)
        const { targets, enriched, topLevelId, parents } = writeMatched(input.resolution, links, {
          language: input.language,
          ratingCountry: input.ratingCountry,
        })
        const itemIds = targets.map((target) => target.id)
        items.replaceLinks({ sourceId: input.source.id, itemIds })
        // An item (or its season, series) left without any file: nothing visible holds its rows.
        const withoutFile = (id: string) => items.sourcesUnder(id).length === 0
        const orphaned = new Set(
          links
            .filter((link) => !isLocal(link) && !itemIds.includes(link.id))
            .filter((link) => withoutFile(link.id))
            .map((link) => link.id),
        )
        // Per-profile rows of the local items left behind (and of the TMDB items left without
        // file, §7.8) go to their replacements, and those of their season and series to the new
        // season and series.
        for (const pair of pairReplacedItems(links, targets, orphaned)) {
          moveItemRows(pair)
          const left = links.find((link) => link.id === pair.from)
          if (left === undefined || parents === undefined) continue
          const { season, series } = ancestorsOf(left)
          for (const [from, into] of [
            [season, parents.season],
            [series, parents.series],
          ] as const) {
            const ancestor = from === undefined ? undefined : items.findItem(from)
            if (
              ancestor !== undefined &&
              ancestor.id !== into &&
              (isLocal(ancestor) || withoutFile(ancestor.id))
            ) {
              moveItemRows({ from: ancestor.id, into })
            }
          }
        }
        items.markAdded({ itemIds, at: input.source.readyAt ?? clock.now() })
        items.pruneOrphans(
          links.map((link) => link.id).filter((id) => !itemIds.includes(id)),
          (pruned) => playbackSessions.endWithin({ itemIds: pruned }),
        )
        sourceRepository.patch(input.source.id, {
          matchState: input.state,
          reviewReason: undefined,
          classification: input.resolution.kind === 'movie' ? 'movie' : 'episode',
        })
        return { itemIds, enriched, topLevelId }
      }),

    /** §7.8: the source waits in "To review"; its local items (if any) stay as they are. */
    review: (sourceId: string, reason: TmdbReviewReason) => {
      sourceRepository.patch(sourceId, { matchState: 'needs_review', reviewReason: reason })
    },
  }
}

export type ApplyMatch = ReturnType<typeof applyMatchFactory>
