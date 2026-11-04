import type { TFunction } from 'i18next'

import type { ItemSummaryDto, PlayTargetDto } from '@projo/shared/api/catalog'

import { formatDuration } from './format.ts'
import { episodeCode, episodeLine, itemTitle } from './item-titles.ts'

const toneCount = 6

export const toneOf = (id: string): number => {
  let hash = 0
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return hash % toneCount
}

type Pictured = Pick<ItemSummaryDto, 'images' | 'series'>

export const posterOf = (item: Pictured): string | undefined =>
  item.images.poster ?? item.series?.images?.poster

export const wideArtOf = (item: Pictured): string | undefined =>
  item.images.still ?? item.images.backdrop ?? item.series?.images?.backdrop

export const cardTitleOf = (
  item: Pick<ItemSummaryDto, 'title' | 'kind' | 'series'>,
): string | undefined =>
  item.kind === 'episode' && item.series?.title !== undefined ? item.series.title : item.title

export type EpisodeLabels = { season: string; episode: string }

export const episodeLabelOf = (
  item: Pick<ItemSummaryDto, 'kind' | 'seasonNumber' | 'episodeNumber'>,
  labels: EpisodeLabels,
): string | undefined =>
  item.kind === 'episode' || item.kind === 'season'
    ? episodeCode(item.seasonNumber, item.episodeNumber, labels) || undefined
    : undefined

export const progressRatioOf = (item: Pick<ItemSummaryDto, 'progress'>): number | undefined => {
  const progress = item.progress
  if (progress?.state !== 'in_progress' || progress.durationMs <= 0) return undefined
  return Math.min(1, Math.max(0, progress.positionMs / progress.durationMs))
}

export const remainingMsOf = (item: Pick<ItemSummaryDto, 'progress'>): number | undefined => {
  const progress = item.progress
  if (progress?.state !== 'in_progress' || progress.durationMs <= 0) return undefined
  return Math.max(0, progress.durationMs - progress.positionMs)
}

export const durationMsOf = (
  item: Pick<ItemSummaryDto, 'durationMs' | 'runtimeMinutes'>,
): number | undefined =>
  item.durationMs ?? (item.runtimeMinutes === undefined ? undefined : item.runtimeMinutes * 60_000)

export const isWatched = (item: Pick<ItemSummaryDto, 'progress' | 'watchStatus'>): boolean =>
  item.progress?.watched === true || item.watchStatus?.state === 'watched'

export const partialCountOf = (
  item: Pick<ItemSummaryDto, 'watchStatus'>,
): { watched: number; total: number } | undefined =>
  item.watchStatus?.state === 'partial'
    ? { watched: item.watchStatus.watchedCount, total: item.watchStatus.totalCount }
    : undefined

export const canListItem = (item: Pick<ItemSummaryDto, 'kind'>): boolean =>
  item.kind === 'movie' || item.kind === 'series'

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

export const isDirectlyPlayable = (item: Pick<ItemSummaryDto, 'kind'>): boolean =>
  item.kind === 'movie' || item.kind === 'episode'

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

export const yearsLabel = (item: Pick<ItemSummaryDto, 'year' | 'endYear'>): string | undefined => {
  if (item.year === undefined) return undefined
  return item.endYear === undefined || item.endYear <= item.year
    ? String(item.year)
    : `${item.year} – ${item.endYear}`
}

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

export type CardPlace =
  'continue_watching' | 'up_next' | 'recently_added' | 'watchlist' | 'category' | 'grid' | 'search'

export const isPosterPlace = (place: CardPlace): boolean =>
  place === 'recently_added' || place === 'category'

export const formatRemaining = (ms: number, locale: string) =>
  formatDuration(Math.ceil(Math.max(ms, 1) / 60_000) * 60_000, locale)

export const playLabelOf = (
  t: TFunction,
  item: Pick<ItemSummaryDto, 'kind' | 'watchStatus'>,
  play: PlayTargetDto | undefined,
): string => {
  const labels = { season: t('item.seasonShort'), episode: t('item.episodeShort') }
  const code = play === undefined ? undefined : episodeLabelOf({ kind: 'episode', ...play }, labels)
  const series = item.kind === 'series' && code !== undefined
  const started =
    (item.watchStatus?.watchedCount ?? 0) + (item.watchStatus?.inProgressCount ?? 0) > 0
  if (play?.action === 'resume')
    return series ? t('item.resumeEpisode', { episode: code }) : t('card.resume')
  return series && started ? t('item.playEpisodeCode', { episode: code }) : t('item.play')
}

export type CardText = {
  title: string
  code?: string
  sub: string
  right?: string
  line: string
  duration?: string
  remaining?: string
}

export const cardTextOf = (t: TFunction, locale: string, item: ItemSummaryDto): CardText => {
  const labels = { season: t('item.seasonShort'), episode: t('item.episodeShort') }
  const code = episodeLabelOf(item, labels)
  const durationMs = durationMsOf(item)
  const duration = durationMs === undefined ? undefined : formatDuration(durationMs, locale)
  const remainingMs = remainingMsOf(item)
  const remaining = remainingMs === undefined ? undefined : formatRemaining(remainingMs, locale)
  const kindLabel =
    item.kind === 'series' ? t('card.series') : item.kind === 'movie' ? t('card.movie') : undefined
  const seasons =
    item.kind === 'series' && item.seasonCount !== undefined && item.seasonCount > 0
      ? t('item.seasonCount', { count: item.seasonCount })
      : undefined
  const typed = [kindLabel, seasons, yearsLabel(item)]
    .filter((part) => part !== undefined)
    .join(' · ')
  const partial = partialCountOf(item)
  const right =
    remaining !== undefined
      ? t('item.remaining', { duration: remaining })
      : partial !== undefined
        ? t('catalog.watchedOf', partial)
        : duration
  return {
    title: cardTitleOf(item) ?? itemTitle(t, item),
    ...(code === undefined ? {} : { code }),
    sub: item.kind === 'episode' ? episodeLine(t, item, 'dotted') : typed,
    ...(right === undefined ? {} : { right }),
    line: item.kind === 'episode' ? episodeLine(t, item) : typed,
    ...(duration === undefined ? {} : { duration }),
    ...(remaining === undefined ? {} : { remaining: t('item.remaining', { duration: remaining }) }),
  }
}
