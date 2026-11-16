import type { ParsedNameDto, ReviewGroupDto, SourceDto } from '@projo/shared/api/libraries'

import { sourceVersionOf } from '../../../core/media/version.ts'
import type { ParsedName } from '../../../core/naming/index.ts'
import { type ReviewGroup, reviewReasonsOf } from '../../../core/source/review-groups.ts'
import type { SourceListItem } from '../../../core/source/source.ts'

export const toParsedNameDto = (parsed: ParsedName): ParsedNameDto => {
  const { part: _part, absoluteEpisodeEnd: _end, ids, ...rest } = parsed
  return {
    ...rest,
    ...(ids === undefined || Object.keys(ids).length === 0 ? {} : { ids: { ...ids } }),
  }
}

const baseName = (relativePath: string): string => relativePath.split('/').at(-1) ?? relativePath

const iso = <K extends string>(key: K, value: Date | undefined) =>
  (value === undefined ? {} : { [key]: value.toISOString() }) as { [P in K]?: string }

export const toSourceDto = (source: SourceListItem): SourceDto => ({
  id: source.id,
  libraryId: source.libraryId,
  rootId: source.rootId,
  path:
    source.rootPath === '/'
      ? `/${source.relativePath}`
      : `${source.rootPath}/${source.relativePath}`,
  relativePath: source.relativePath,
  state: source.state,
  sizeBytes: source.sizeBytes,
  discoveredAt: source.discoveredAt.toISOString(),
  classification: source.classification,
  displayTitle: source.parsed.title ?? source.parsed.series ?? baseName(source.relativePath),
  matchState: source.matchState,
  parsed: toParsedNameDto(source.parsed),
  itemIds: source.itemIds,
  items: source.items,
  ...(source.pendingReason === undefined ? {} : { pendingReason: source.pendingReason }),
  ...iso('pendingSince', source.pendingSince),
  ...(source.state === 'pending' ? iso('unchangedSince', source.unchangedSince) : {}),
  ...iso('stableSince', source.stableSince),
  ...iso('readyAt', source.readyAt),
  ...iso('missingSince', source.missingSince),
  ...(source.reviewReason === undefined ? {} : { reviewReason: source.reviewReason }),
  version: sourceVersionOf(source.probe?.video[0], source.parsed),
  ...(source.probe === undefined ? {} : { durationMs: Math.round(source.probe.durationMs) }),
})

/** A series group of "To review" (§7.8) without its first file, for HTTP and MCP alike. */
export const toReviewGroupHeader = (group: ReviewGroup): Omit<ReviewGroupDto, 'first'> => ({
  id: group.files[0]?.id ?? '',
  count: group.files.length,
  ...(group.series?.title === undefined ? {} : { series: group.series.title }),
  ...(group.series === undefined ? {} : { showFolder: group.series.showFolder }),
  reasons: reviewReasonsOf(group),
})

export const toReviewGroupDto = ({
  group,
  first,
}: {
  group: ReviewGroup
  first: SourceListItem
}): ReviewGroupDto => ({ ...toReviewGroupHeader(group), first: toSourceDto(first) })
