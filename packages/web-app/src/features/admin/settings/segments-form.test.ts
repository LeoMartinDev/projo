import { describe, expect, test } from 'bun:test'

import type { SegmentSettingsDto } from '@projo/shared/api/segments'

import { changedFields } from './settings-draft.ts'
import { segmentsChanges, type SegmentsDraft, segmentsDraftOf } from './segments-form.ts'

const segments: SegmentSettingsDto = {
  providers: ['theintrodb', 'introdb'],
  theintrodbApiKey: { configured: false },
  fingerprint: {
    enabled: true,
    introMinutes: 10,
    creditsMinutes: 5,
    minSeconds: 15,
    maxSeconds: 120,
    similarity: 0.85,
  },
  contribution: 'off',
}

const saved = segmentsDraftOf(segments)
const bodyOf = (edits: Partial<SegmentsDraft>) =>
  segmentsChanges({ ...saved, ...edits }, changedFields(saved, edits))

describe('the Intros and credits tab (§15)', () => {
  test('sends only what changed', () => {
    expect(
      bodyOf({ providers: ['introdb', 'theintrodb'], similarity: '90', contribution: true }),
    ).toEqual({
      ok: true,
      value: {
        segments: {
          providers: ['introdb', 'theintrodb'],
          fingerprint: { similarity: 0.9 },
          contribution: 'manual_only',
        },
      },
    })
    expect(bodyOf({ fingerprintEnabled: false })).toEqual({
      ok: true,
      value: { segments: { fingerprint: { enabled: false } } },
    })
    expect(bodyOf({ similarity: '85' })).toEqual({ ok: true, value: { segments: {} } })
  })

  test('names the thresholds that cannot be saved', () => {
    expect(bodyOf({ minSeconds: '120' })).toEqual({
      ok: false,
      error: ['minSeconds', 'maxSeconds'],
    })
  })
})
