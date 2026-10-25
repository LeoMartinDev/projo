import type { ItemSummaryDto } from '@projo/shared/api/catalog'
import type { ResumeFrameDto } from '@projo/shared/api/home'

import { episodeCode } from '../../shared/format/format.ts'

/**
 * What the spectator cards show of an item (§13.3, §19 "Formats d'images"), pure so the rules
 * are tested in Bun: which picture, which progress, where a click leads.
 */

const toneCount = 6

/** Stable tone per item: the colour of a card whose picture is missing (§13.5 "repli"). */
export const toneOf = (id: string): number => {
  let hash = 0
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return hash % toneCount
}

type Pictured = Pick<ItemSummaryDto, 'images' | 'series'>

/** 2:3 poster: the item's, or its series' for an episode. */
export const posterOf = (item: Pictured): string | undefined =>
  item.images.poster ?? item.series?.images?.poster

/** 16:9 picture: an episode's still, else the backdrop, else the series' backdrop. */
export const wideArtOf = (item: Pictured): string | undefined =>
  item.images.still ?? item.images.backdrop ?? item.series?.images?.backdrop

/**
 * Big title of a card: an episode shows its series (artboard `Home`). Undefined for an item
 * without a title of its own (§6.3): the caller labels it from its number (`itemTitle`).
 */
export const cardTitleOf = (
  item: Pick<ItemSummaryDto, 'title' | 'kind' | 'series'>,
): string | undefined =>
  item.kind === 'episode' && item.series?.title !== undefined ? item.series.title : item.title

export type EpisodeLabels = { season: string; episode: string }

/** `S2 · E4`, or nothing for an item outside a series. */
export const episodeLabelOf = (
  item: Pick<ItemSummaryDto, 'kind' | 'seasonNumber' | 'episodeNumber'>,
  labels: EpisodeLabels,
): string | undefined =>
  item.kind === 'episode' || item.kind === 'season'
    ? episodeCode(item.seasonNumber, item.episodeNumber, labels) || undefined
    : undefined

/** Movies and episodes: the position as a 0..1 ratio while "en cours" (§13.1). */
export const progressRatioOf = (item: Pick<ItemSummaryDto, 'progress'>): number | undefined => {
  const progress = item.progress
  if (progress?.state !== 'in_progress' || progress.durationMs <= 0) return undefined
  return Math.min(1, Math.max(0, progress.positionMs / progress.durationMs))
}

/** Time left of an item in progress. */
export const remainingMsOf = (item: Pick<ItemSummaryDto, 'progress'>): number | undefined => {
  const progress = item.progress
  if (progress?.state !== 'in_progress' || progress.durationMs <= 0) return undefined
  return Math.max(0, progress.durationMs - progress.positionMs)
}

/** Running time: the probed file first, TMDB's runtime otherwise. */
export const durationMsOf = (
  item: Pick<ItemSummaryDto, 'durationMs' | 'runtimeMinutes'>,
): number | undefined =>
  item.durationMs ?? (item.runtimeMinutes === undefined ? undefined : item.runtimeMinutes * 60_000)

/** Watched as a whole: a movie or episode seen, a series or season with every episode seen. */
export const isWatched = (item: Pick<ItemSummaryDto, 'progress' | 'watchStatus'>): boolean =>
  item.progress?.watched === true || item.watchStatus?.state === 'watched'

/** Partly watched series or season: "x / n vus". */
export const partialCountOf = (
  item: Pick<ItemSummaryDto, 'watchStatus'>,
): { watched: number; total: number } | undefined =>
  item.watchStatus?.state === 'partial'
    ? { watched: item.watchStatus.watchedCount, total: item.watchStatus.totalCount }
    : undefined

/** "My list" holds movies and series only; an episode has no toggle of its own. */
export const canListItem = (item: Pick<ItemSummaryDto, 'kind'>): boolean =>
  item.kind === 'movie' || item.kind === 'series'

/**
 * Detail page of an item: an episode or a season opens its series on the right season tab, so
 * "More info" on an "Up next" card lands on the episode list.
 */
export const detailTargetOf = (
  item: Pick<ItemSummaryDto, 'id' | 'kind' | 'seasonNumber' | 'series'>,
): { itemId: string; season?: number } => {
  if ((item.kind === 'episode' || item.kind === 'season') && item.series !== undefined) {
    return item.seasonNumber === undefined
      ? { itemId: item.series.id }
      : { itemId: item.series.id, season: item.seasonNumber }
  }
  return { itemId: item.id }
}

/** Movies and episodes play directly; a series needs its "Lire / Reprendre" target first. */
export const isDirectlyPlayable = (item: Pick<ItemSummaryDto, 'kind'>): boolean =>
  item.kind === 'movie' || item.kind === 'episode'

/** Badge of the best file (§13.5 "4K HDR"): `4K`, `HD`, `SD`, with `HDR` or `Dolby Vision`. */
export const qualityLabel = (
  quality:
    | { resolution: '2160p' | '1080p' | '720p' | 'SD'; dynamicRange: 'sdr' | 'hdr' | 'dv' }
    | undefined,
): string | undefined => {
  if (quality === undefined) return undefined
  const resolution =
    quality.resolution === '2160p' ? '4K' : quality.resolution === 'SD' ? 'SD' : 'HD'
  const range =
    quality.dynamicRange === 'hdr'
      ? 'HDR'
      : quality.dynamicRange === 'dv'
        ? 'Dolby Vision'
        : undefined
  return range === undefined ? resolution : `${resolution} ${range}`
}

/** Years of an item: "2023", or "2023 – 2025" for a series aired over several years (§13.5). */
export const yearsLabel = (item: Pick<ItemSummaryDto, 'year' | 'endYear'>): string | undefined => {
  if (item.year === undefined) return undefined
  return item.endYear === undefined || item.endYear <= item.year
    ? String(item.year)
    : `${item.year} – ${item.endYear}`
}

/**
 * What the "My list" button of a card acts on: a movie or a series itself; an episode of a home
 * row, its series (§13.3). `undefined` when nothing can be listed.
 */
export const listTargetOf = (
  item: Pick<ItemSummaryDto, 'id' | 'kind' | 'inWatchlist' | 'series'>,
): { id: string; inWatchlist?: boolean } | undefined => {
  if (canListItem(item)) {
    return {
      id: item.id,
      ...(item.inWatchlist === undefined ? {} : { inWatchlist: item.inWatchlist }),
    }
  }
  if (item.kind !== 'episode' || item.series?.inWatchlist === undefined) return undefined
  return { id: item.series.id, inWatchlist: item.series.inWatchlist }
}

/**
 * Placement of a resume frame (a cell of a timeline sprite sheet, §10.5) in a 16:9 card, like
 * `object-fit: cover`: `box` is the frame centred and cropped by the card, `sheet` the whole sheet
 * inside it, shifted so that only the cell shows. All in percentages: it scales with the card.
 */
export type ResumeFrameLayout = {
  box: { left: string; top: string; width: string; height: string }
  sheet: { left: string; top: string; width: string; height: string }
}

const percent = (value: number): string => `${Math.round(value * 1e4) / 1e2}%`

export const resumeFrameLayout = (
  frame: Pick<ResumeFrameDto, 'x' | 'y' | 'width' | 'height' | 'sheetWidth' | 'sheetHeight'>,
  cardRatio = 16 / 9,
): ResumeFrameLayout => {
  const wider = frame.width / frame.height >= cardRatio
  const width = wider ? frame.width / frame.height / cardRatio : 1
  const height = wider ? 1 : cardRatio / (frame.width / frame.height)
  return {
    box: {
      left: percent((1 - width) / 2),
      top: percent((1 - height) / 2),
      width: percent(width),
      height: percent(height),
    },
    sheet: {
      left: percent(-frame.x / frame.width),
      top: percent(-frame.y / frame.height),
      width: percent(frame.sheetWidth / frame.width),
      height: percent(frame.sheetHeight / frame.height),
    },
  }
}
