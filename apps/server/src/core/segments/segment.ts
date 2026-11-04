import type { AppError, Result } from '@projo/shared'

export const segmentTypes = ['intro', 'recap', 'credits', 'preview'] as const
export type SegmentType = (typeof segmentTypes)[number]

export const segmentOrigins = [
  'manual',
  'chapter',
  'theintrodb',
  'introdb',
  'skipdb',
  'fingerprint',
] as const
export type SegmentOrigin = (typeof segmentOrigins)[number]

export const segmentProviderIds = ['theintrodb', 'introdb', 'skipdb'] as const
export type SegmentProviderId = (typeof segmentProviderIds)[number]

export type Segment = {
  id: string
  itemId: string
  type: SegmentType
  startMs: number
  endMs: number
  origin: SegmentOrigin
  confidence?: number
  createdAt: Date
}

export type SegmentCandidate = Pick<Segment, 'type' | 'startMs' | 'endMs'> & { confidence?: number }

const originRank: Record<SegmentOrigin, number> = {
  manual: 3,
  chapter: 2,
  theintrodb: 1,
  introdb: 1,
  skipdb: 1,
  fingerprint: 0,
}

export const canReplace = (existing: SegmentOrigin | undefined, next: SegmentOrigin): boolean =>
  existing === undefined || originRank[next] >= originRank[existing]

export type SegmentLookupOutcome = 'found' | 'none' | 'no_segment' | 'error'

export type SegmentLookupKey =
  'chapter' | SegmentProviderId | 'fingerprint' | `no_segment:${SegmentType}`

export const noSegmentKey = (type: SegmentType): SegmentLookupKey => `no_segment:${type}`

export type SegmentLookupRow = {
  itemId: string
  provider: SegmentLookupKey
  checkedAt: Date
  outcome: SegmentLookupOutcome
}

export const lookupRetryAfterMs: Record<SegmentLookupOutcome, number | undefined> = {
  found: undefined,
  no_segment: undefined,
  none: 30 * 24 * 60 * 60_000,
  error: 7 * 24 * 60 * 60_000,
}

export const isLookupFresh = (row: SegmentLookupRow, now: Date): boolean => {
  const retryAfter = lookupRetryAfterMs[row.outcome]
  return retryAfter === undefined || now.getTime() - row.checkedAt.getTime() < retryAfter
}

export type SegmentRepository = {
  listByItem: (itemId: string) => Segment[]
  find: (input: { itemId: string; type: SegmentType }) => Segment | undefined
  save: (input: {
    itemId: string
    origin: SegmentOrigin
    candidate: SegmentCandidate
  }) => Segment | undefined
  remove: (input: { itemId: string; type: SegmentType }) => boolean
  listLookups: (itemId: string) => SegmentLookupRow[]
  saveLookup: (row: SegmentLookupRow) => void
  removeLookup: (input: { itemId: string; provider: SegmentLookupKey }) => void
}

export type SegmentItemRef = {
  itemId: string
  kind: 'movie' | 'episode'
  tmdbId?: number
  imdbId?: string
  tvdbId?: number
  seasonId?: string
  seasonNumber?: number
  episodeNumber?: number
  episodeTitle?: string
  durationMs?: number
  detectSegments: boolean
}

export type SegmentProviderError = AppError<
  | 'segment/provider_unavailable'
  | 'segment/provider_invalid_response'
  | 'segment/provider_rate_limited'
>

export type SegmentLookup = {
  segments: SegmentCandidate[]
  absent: SegmentType[]
}

export type SegmentProvider = {
  id: SegmentProviderId
  lookup: (
    item: SegmentItemRef,
    fileDurationMs: number | undefined,
    signal?: AbortSignal,
  ) => Promise<Result<SegmentLookup, SegmentProviderError>>
}

export type SegmentContributor = {
  id: Extract<SegmentProviderId, 'theintrodb' | 'skipdb'>
  submit: (
    item: SegmentItemRef,
    segment: Pick<Segment, 'type' | 'startMs' | 'endMs'>,
  ) => Promise<Result<void, AppError<'segment/submission_failed' | 'segment/provider_unavailable'>>>
}

export type SegmentSubmissionRepository = {
  record: (input: {
    itemId: string
    type: SegmentType
    provider: SegmentContributor['id']
    startMs: number
    endMs: number
    outcome: 'submitted' | 'failed'
    error?: string
    at: Date
  }) => void
  wasSubmitted: (input: {
    itemId: string
    type: SegmentType
    provider: SegmentContributor['id']
    startMs: number
    endMs: number
  }) => boolean
}

export const nextUpFallback = { remainingMs: 90_000, remainingRatio: 0.02 } as const
