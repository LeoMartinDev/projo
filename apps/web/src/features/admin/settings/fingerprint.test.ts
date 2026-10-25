import { describe, expect, test } from 'bun:test'

import { changedThresholds, checkThresholds, thresholdsDraftOf } from './fingerprint.ts'

const defaults = {
  introMinutes: 10,
  creditsMinutes: 5,
  minSeconds: 15,
  maxSeconds: 150,
  similarity: 0.85,
}

describe('checkThresholds', () => {
  test('the stored values round-trip, similarity in percent', () => {
    const draft = thresholdsDraftOf(defaults)
    expect(draft.similarity).toBe('85')
    expect(checkThresholds(draft)).toEqual({ ok: true, value: defaults })
  })

  test('names the fields out of bounds or not whole numbers', () => {
    const draft = { ...thresholdsDraftOf(defaults), introMinutes: '31', similarity: '9.5' }
    expect(checkThresholds(draft)).toEqual({ ok: false, invalid: ['introMinutes', 'similarity'] })
    expect(checkThresholds({ ...draft, introMinutes: '', similarity: '85' })).toEqual({
      ok: false,
      invalid: ['introMinutes'],
    })
  })

  test('the shortest sequence must stay below the longest', () => {
    const draft = { ...thresholdsDraftOf(defaults), minSeconds: '60', maxSeconds: '60' }
    expect(checkThresholds(draft)).toEqual({ ok: false, invalid: ['minSeconds', 'maxSeconds'] })
  })
})

test('changedThresholds keeps only what changed', () => {
  expect(changedThresholds(defaults, { ...defaults, maxSeconds: 120, similarity: 0.9 })).toEqual({
    maxSeconds: 120,
    similarity: 0.9,
  })
  expect(changedThresholds(defaults, defaults)).toEqual({})
})
