import type { SegmentSettingsDto } from '@projo/shared/api/segments'

/**
 * Fingerprinting thresholds of the "Intros and credits" settings (§12.3, §15), typed as text: bounds of
 * `updateSegmentSettingsBodySchema`, similarity shown as a percentage. Pure: tests run in Bun.
 */

export type Thresholds = Omit<SegmentSettingsDto['fingerprint'], 'enabled'>
export type ThresholdField = keyof Thresholds
export type ThresholdsDraft = Record<ThresholdField, string>

export const thresholdFields = [
  'introMinutes',
  'creditsMinutes',
  'minSeconds',
  'maxSeconds',
  'similarity',
] as const satisfies readonly ThresholdField[]

/** Bounds in the unit of the field as typed (similarity in percent). */
export const thresholdBounds: Record<ThresholdField, { min: number; max: number }> = {
  introMinutes: { min: 1, max: 30 },
  creditsMinutes: { min: 1, max: 15 },
  minSeconds: { min: 5, max: 120 },
  maxSeconds: { min: 30, max: 600 },
  similarity: { min: 50, max: 100 },
}

export const thresholdsDraftOf = (thresholds: Thresholds): ThresholdsDraft => ({
  introMinutes: String(thresholds.introMinutes),
  creditsMinutes: String(thresholds.creditsMinutes),
  minSeconds: String(thresholds.minSeconds),
  maxSeconds: String(thresholds.maxSeconds),
  similarity: String(Math.round(thresholds.similarity * 100)),
})

export type CheckedThresholds =
  { ok: true; value: Thresholds } | { ok: false; invalid: readonly ThresholdField[] }

/** Whole numbers within bounds, and a shortest common sequence below the longest. */
export const checkThresholds = (draft: ThresholdsDraft): CheckedThresholds => {
  const read = (field: ThresholdField) => {
    const text = draft[field].trim()
    const value = Number(text)
    const { min, max } = thresholdBounds[field]
    return /^\d+$/u.test(text) && value >= min && value <= max ? value : undefined
  }
  const values = Object.fromEntries(thresholdFields.map((field) => [field, read(field)]))
  const invalid: ThresholdField[] = thresholdFields.filter((field) => values[field] === undefined)
  const { introMinutes, creditsMinutes, minSeconds, maxSeconds, similarity } = values
  if (
    introMinutes === undefined ||
    creditsMinutes === undefined ||
    minSeconds === undefined ||
    maxSeconds === undefined ||
    similarity === undefined
  )
    return { ok: false, invalid }
  if (minSeconds >= maxSeconds) return { ok: false, invalid: ['minSeconds', 'maxSeconds'] }
  return {
    ok: true,
    value: { introMinutes, creditsMinutes, minSeconds, maxSeconds, similarity: similarity / 100 },
  }
}

/** Only the thresholds that changed (the section is patched partially). */
export const changedThresholds = (stored: Thresholds, next: Thresholds): Partial<Thresholds> =>
  Object.fromEntries(
    thresholdFields
      .filter((field) => Math.abs(stored[field] - next[field]) > 1e-9)
      .map((field) => [field, next[field]]),
  )
