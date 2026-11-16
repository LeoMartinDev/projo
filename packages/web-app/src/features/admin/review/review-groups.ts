import type { TFunction } from 'i18next'

import type { ReviewGroupDto, ReviewReasonCount, SourceDto } from '@projo/shared/api/libraries'

import { formatNumber } from '../../../shared/format/format.ts'
import type { IdentifyInitial } from '../identify/IdentifyForm.tsx'
import { initialFromSource } from './parsed.ts'

/** A group of several files (§7.8): it unfolds, and its actions act on the whole series. */
export const isSeriesGroup = (group: Pick<ReviewGroupDto, 'count'>): boolean => group.count > 1

/**
 * What keeps a group unfolded across refreshes: its series, show folder and root, which stay the same
 * when its first file (the group's id) is identified or hidden on its own.
 */
export const groupKey = (
  group: Pick<ReviewGroupDto, 'id' | 'series' | 'showFolder'> & {
    first: Pick<SourceDto, 'libraryId' | 'rootId'>
  },
) =>
  group.series === undefined || group.showFolder === undefined
    ? group.id
    : [group.first.libraryId, group.first.rootId, group.showFolder, group.series].join('\u0000')

/** "<show> · N files". */
export const groupLabel = (
  t: TFunction,
  locale: string,
  group: Pick<ReviewGroupDto, 'count' | 'series'> & {
    first: Pick<SourceDto, 'parsed' | 'displayTitle'>
  },
): string =>
  t('admin.review.groupLabel', {
    count: group.count,
    formatted: formatNumber(group.count, locale),
    series: group.series ?? group.first.parsed.series ?? group.first.displayTitle,
  })

/** The show folder on the disk: the library root of its first file, then the folder below it. */
export const showFolderPath = (
  group: Pick<ReviewGroupDto, 'showFolder'> & { first: Pick<SourceDto, 'path' | 'relativePath'> },
): string | undefined => {
  if (group.showFolder === undefined) return undefined
  const { path, relativePath } = group.first
  const root = path.endsWith(relativePath)
    ? path.slice(0, path.length - relativePath.length).replace(/[\\/]+$/u, '')
    : ''
  const folder = group.showFolder.replace(/^[\\/]+/u, '')
  if (folder.length === 0) return root.length === 0 ? '/' : root
  return root.length === 0 ? `/${folder}` : `${root}/${folder}`
}

export type ReasonsSummary = {
  /** The most frequent reason, drawn as a badge. */
  main?: string
  /** How many other reasons the group's files have. */
  others: number
  /** Every reason with its number of files, for the tooltip and screen readers. */
  detail: string
}

const reasonLabel = (t: TFunction, reason: ReviewReasonCount['reason']) =>
  t(`admin.review.reason.${reason}`)

/** The reasons of a group, most frequent first (as the server sends them). */
export const reasonsSummary = (
  t: TFunction,
  locale: string,
  reasons: readonly ReviewReasonCount[],
): ReasonsSummary => {
  const [first] = reasons
  return {
    ...(first === undefined ? {} : { main: reasonLabel(t, first.reason) }),
    others: Math.max(reasons.length - 1, 0),
    detail: reasons
      .map(({ reason, count }) =>
        t('admin.review.reasonCount', {
          reason: reasonLabel(t, reason),
          formatted: formatNumber(count, locale),
        }),
      )
      .join(', '),
  }
}

/** Identifying a group is "It's an episode of…" on its first file, which takes the others along. */
export const initialFromGroup = (
  first: Pick<SourceDto, 'parsed' | 'displayTitle' | 'classification'>,
): IdentifyInitial => {
  const initial = initialFromSource(first)
  if (initial.mode === 'episode') return initial
  const { parsed } = first
  const episode = parsed.episode ?? parsed.absoluteEpisode
  return {
    mode: 'episode',
    query: parsed.series ?? initial.query,
    ...(parsed.season === undefined ? {} : { season: parsed.season }),
    ...(episode === undefined ? {} : { episode }),
  }
}

/** Placeholder rows of an unfolding group: its files, a few at most. */
export const loadingRows = (count: number): number => Math.max(1, Math.min(count, 4))
