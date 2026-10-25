import type { AppError, Result } from '@projo/shared'

/**
 * §12 Intros, credits and segments: the model, the priority rule and the ports of the resolution chain.
 * Positions are on the **item** timeline (cumulative over the parts of a stack, §7.7), like the
 * playback session DTO.
 */

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

/** The community databases (§12.2 rows 3 to 5), in their default order (§24). */
export const segmentProviderIds = ['theintrodb', 'introdb', 'skipdb'] as const
export type SegmentProviderId = (typeof segmentProviderIds)[number]

export type Segment = {
  id: string
  itemId: string
  type: SegmentType
  startMs: number
  endMs: number
  origin: SegmentOrigin
  /** 0 to 1: a provider's own confidence, or the share of corroborating episodes (§12.3). */
  confidence?: number
  createdAt: Date
}

/** A segment found by a source of the chain, before it is stored. */
export type SegmentCandidate = Pick<Segment, 'type' | 'startMs' | 'endMs'> & { confidence?: number }

/** §12.1: manuel > chapitre > bases communautaires > fingerprint. */
const originRank: Record<SegmentOrigin, number> = {
  manual: 3,
  chapter: 2,
  theintrodb: 1,
  introdb: 1,
  skipdb: 1,
  fingerprint: 0,
}

/**
 * §12.1: a new segment replaces the stored one of the same type only if its origin has an equal
 * or higher priority.
 */
export const canReplace = (existing: SegmentOrigin | undefined, next: SegmentOrigin): boolean =>
  existing === undefined || originRank[next] >= originRank[existing]

// ── Lookups cache (§6.4 `segment_lookups`, §12.2) ──────────────────────────────────────────

/**
 * `found`: at least one segment; `none`: the source has nothing; `no_segment`: the work is known
 * to lack the segment (negative marker, stops the chain); `error`: unreachable or invalid.
 */
export type SegmentLookupOutcome = 'found' | 'none' | 'no_segment' | 'error'

/**
 * Key of a `segment_lookups` row: one per source of the chain that was asked (`chapter`, a
 * provider id, `fingerprint`), plus `no_segment:<type>` for a negative marker of one type (set by
 * the admin, "Pas d'intro"; `outcome = no_segment`).
 */
export type SegmentLookupKey =
  'chapter' | SegmentProviderId | 'fingerprint' | `no_segment:${SegmentType}`

export const noSegmentKey = (type: SegmentType): SegmentLookupKey => `no_segment:${type}`

export type SegmentLookupRow = {
  itemId: string
  provider: SegmentLookupKey
  checkedAt: Date
  outcome: SegmentLookupOutcome
}

/** §12.2: `none` retried after 30 days, `error` after 7, `found` and `no_segment` never. */
export const lookupRetryAfterMs: Record<SegmentLookupOutcome, number | undefined> = {
  found: undefined,
  no_segment: undefined,
  none: 30 * 24 * 60 * 60_000,
  error: 7 * 24 * 60 * 60_000,
}

/** True when the cached row still answers for the provider at `now`. */
export const isLookupFresh = (row: SegmentLookupRow, now: Date): boolean => {
  const retryAfter = lookupRetryAfterMs[row.outcome]
  return retryAfter === undefined || now.getTime() - row.checkedAt.getTime() < retryAfter
}

// ── Repositories ───────────────────────────────────────────────────────────────────────────

export type SegmentRepository = {
  listByItem: (itemId: string) => Segment[]
  find: (input: { itemId: string; type: SegmentType }) => Segment | undefined
  /**
   * Stores `candidate` unless a segment of the same type with a higher-priority origin exists
   * (`canReplace`); returns the stored segment, or `undefined` when it was kept out.
   */
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

/** What the chain needs to know about a movie or an episode. */
export type SegmentItemRef = {
  itemId: string
  kind: 'movie' | 'episode'
  /** Of the movie, or of the episode's series (§9.2 `/external_ids`). */
  tmdbId?: number
  imdbId?: string
  tvdbId?: number
  seasonId?: string
  seasonNumber?: number
  episodeNumber?: number
  episodeTitle?: string
  /** The played file, summed over the parts of a stack (`duration_ms` of TheIntroDB). */
  durationMs?: number
  /** `libraries.detect_segments` of a library holding a ready source of the item. */
  detectSegments: boolean
}

// ── Providers (§12.2) ──────────────────────────────────────────────────────────────────────

export type SegmentProviderError = AppError<
  | 'segment/provider_unavailable'
  | 'segment/provider_invalid_response'
  | 'segment/provider_rate_limited'
>

/**
 * A provider's answer: confirmed segments (one per type at most: the provider's best, already
 * mapped to projo types, `outro` → `credits`, `post_credits` ignored), and the types it states
 * the work does not have (none of the three APIs do today: always empty, kept for the model).
 */
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

/** §12.5: submission of a manual marker to a provider that accepts them. */
export type SegmentContributor = {
  id: Extract<SegmentProviderId, 'theintrodb' | 'skipdb'>
  submit: (
    item: SegmentItemRef,
    segment: Pick<Segment, 'type' | 'startMs' | 'endMs'>,
  ) => Promise<Result<void, AppError<'segment/submission_failed' | 'segment/provider_unavailable'>>>
}

/** §12.5 "Each submission is logged" (`segment_submissions`). */
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
  /** True when this exact marker was already submitted to that provider. */
  wasSubmitted: (input: {
    itemId: string
    type: SegmentType
    provider: SegmentContributor['id']
    startMs: number
    endMs: number
  }) => boolean
}

// ── Jobs ───────────────────────────────────────────────────────────────────────────────────

/** `fetch_segments` (§18): one per item, dedupe `segments:<itemId>`. */
export type FetchSegmentsPayload = { itemId: string }
/** `fingerprint_season` (§12.3): one per season, dedupe `fingerprint:<seasonId>`. */
export type FingerprintSeasonPayload = { seasonId: string }
/** `submit_segment` (§12.5): one per manual marker, dedupe `submit:<itemId>:<type>`. */
export type SubmitSegmentPayload = { itemId: string; type: SegmentType }

/** §12.4 fallback: "Next episode" when less than 90 s or 2 % of the duration remains. */
export const nextUpFallback = { remainingMs: 90_000, remainingRatio: 0.02 } as const
