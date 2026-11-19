import type {
  SegmentProviderIdDto,
  SegmentSettingsDto,
  UpdateSegmentSettingsBody,
} from '@projo/shared/api/segments'
import { err, ok, type Result } from '@projo/shared/result'

import {
  checkThresholds,
  type ThresholdField,
  thresholdFields,
  type ThresholdsDraft,
  thresholdsDraftOf,
} from './fingerprint.ts'

/**
 * The Intros and credits tab's form (§12): the providers in their order, fingerprinting and its
 * thresholds as typed, contribution. TheIntroDB's key is replaced apart, through its "Validate".
 */
export type SegmentsDraft = ThresholdsDraft & {
  providers: readonly SegmentProviderIdDto[]
  fingerprintEnabled: boolean
  contribution: boolean
}

export const segmentsDraftOf = (segments: SegmentSettingsDto): SegmentsDraft => {
  const { enabled, ...thresholds } = segments.fingerprint
  return {
    ...thresholdsDraftOf(thresholds),
    providers: segments.providers,
    fingerprintEnabled: enabled,
    contribution: segments.contribution === 'manual_only',
  }
}

/** The body of "Save": the changed fields only; or the thresholds that are not valid. */
export const segmentsChanges = (
  draft: SegmentsDraft,
  changed: Partial<SegmentsDraft>,
): Result<{ segments: UpdateSegmentSettingsBody }, readonly ThresholdField[]> => {
  const checked = checkThresholds(draft)
  if (!checked.ok) return err(checked.invalid)
  const thresholds = Object.fromEntries(
    thresholdFields.flatMap((field) =>
      changed[field] === undefined ? [] : [[field, checked.value[field]]],
    ),
  )
  const fingerprint = {
    ...thresholds,
    ...(changed.fingerprintEnabled === undefined ? {} : { enabled: draft.fingerprintEnabled }),
  }
  return ok({
    segments: {
      ...(changed.providers === undefined ? {} : { providers: [...draft.providers] }),
      ...(Object.keys(fingerprint).length === 0 ? {} : { fingerprint }),
      ...(changed.contribution === undefined
        ? {}
        : { contribution: draft.contribution ? 'manual_only' : 'off' }),
    },
  })
}
