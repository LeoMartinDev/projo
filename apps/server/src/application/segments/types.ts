import type { AppError, Result } from '@projo/shared'

import type {
  Segment,
  SegmentLookupRow,
  SegmentProviderError,
  SegmentType,
} from '../../core/segments/segment.ts'
import type { SegmentSettings } from '../../core/settings/settings.ts'

export type ItemSegmentsView = {
  itemId: string
  durationMs?: number
  segments: Segment[]
  absent: SegmentType[]
  lookups: SegmentLookupRow[]
}

export type GetItemSegments = (input: {
  itemId: string
  profileId: string
  withLookups: boolean
}) => Result<ItemSegmentsView, AppError<'item/not_found' | 'item/invalid_kind'>>

export type ManualMarker = { startMs: number; endMs: number } | { absent: true }

export type SetManualSegmentError = AppError<
  'item/not_found' | 'item/invalid_kind' | 'segment/invalid_range'
>

export type SetManualSegment = (input: {
  itemId: string
  type: SegmentType
  marker: ManualMarker
}) => Result<ItemSegmentsView, SetManualSegmentError>

export type RemoveSegment = (input: {
  itemId: string
  type: SegmentType
}) => Result<ItemSegmentsView, AppError<'item/not_found' | 'segment/not_found'>>

export type ApplyToSeasonError = AppError<'item/not_found' | 'segment/not_an_episode'>

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
  theintrodbApiKey?: string
  fingerprint?: Partial<SegmentSettings['fingerprint']>
  contribution?: SegmentSettings['contribution']
}

export type UpdateSegmentSettingsError =
  | AppError<'segment/theintrodb_key_invalid' | 'segment/contribution_requires_key'>
  | SegmentProviderError

export type SegmentSettingsAdmin = {
  get: () => SegmentSettingsView
  update: (
    input: UpdateSegmentSettingsInput,
  ) => Promise<Result<SegmentSettingsView, UpdateSegmentSettingsError>>
}
