import type { AppError, Result } from '@projo/shared'

import type {
  Segment,
  SegmentLookupRow,
  SegmentProviderError,
  SegmentType,
} from '../../core/segments/segment.ts'
import type { SegmentSettings } from '../../core/settings/settings.ts'

/** The use cases the segment routes call (§12, §17.2). Built by `entrypoints/modules/segments.ts`. */

export type ItemSegmentsView = {
  itemId: string
  durationMs?: number
  segments: Segment[]
  /** Types with a negative marker (`no_segment:<type>` lookups). */
  absent: SegmentType[]
  /** The chain's lookups (negative markers excluded); empty unless asked (`withLookups`). */
  lookups: SegmentLookupRow[]
}

/** `GET /items/:id/segments`: a movie or an episode the profile sees (§14), else `item/not_found`. */
export type GetItemSegments = (input: {
  itemId: string
  profileId: string
  withLookups: boolean
}) => Result<ItemSegmentsView, AppError<'item/not_found' | 'item/invalid_kind'>>

export type ManualMarker = { startMs: number; endMs: number } | { absent: true }

export type SetManualSegmentError = AppError<
  'item/not_found' | 'item/invalid_kind' | 'segment/invalid_range'
>

/**
 * `PUT /admin/items/:id/segments/:type` (§12.5): stores a `manual` segment (or a negative marker),
 * then, when `segment_contribution = manual_only`, enqueues `submit_segment`.
 */
export type SetManualSegment = (input: {
  itemId: string
  type: SegmentType
  marker: ManualMarker
}) => Result<ItemSegmentsView, SetManualSegmentError>

/**
 * `DELETE /admin/items/:id/segments/:type`: removes the segment of that type (any origin) and its
 * negative marker, forgets the cached lookups and enqueues `fetch_segments` again.
 */
export type RemoveSegment = (input: {
  itemId: string
  type: SegmentType
}) => Result<ItemSegmentsView, AppError<'item/not_found' | 'segment/not_found'>>

export type ApplyToSeasonError = AppError<'item/not_found' | 'segment/not_an_episode'>

/** `POST /admin/items/:id/segments/apply-to-season` (§12.2 row 1). */
export type ApplySegmentsToSeason = (input: {
  itemId: string
  types?: SegmentType[]
}) => Result<{ updated: number; skipped: number }, ApplyToSeasonError>

export type SegmentSettingsView = Omit<
  SegmentSettings,
  'theintrodbApiKey' | 'skipdbAnonymousKey'
> & {
  theintrodbApiKey: { configured: boolean; last4?: string }
}

export type UpdateSegmentSettingsInput = {
  providers?: SegmentSettings['providers']
  /** `""` removes the key. */
  theintrodbApiKey?: string
  fingerprint?: Partial<SegmentSettings['fingerprint']>
  contribution?: SegmentSettings['contribution']
}

export type UpdateSegmentSettingsError =
  | AppError<'segment/theintrodb_key_invalid' | 'segment/contribution_requires_key'>
  | SegmentProviderError

/** §15 "Intros and credits": the section of `GET/PATCH /admin/settings`. */
export type SegmentSettingsAdmin = {
  get: () => SegmentSettingsView
  update: (
    input: UpdateSegmentSettingsInput,
  ) => Promise<Result<SegmentSettingsView, UpdateSegmentSettingsError>>
}
