import { describe, expect, test } from 'bun:test'

import type { MediaSegmentDto } from '@projo/shared/api/playback'

import {
  countdownFor,
  countdownRatio,
  countdownStartMs,
  fallbackWindowMs,
  nextUpCountdownMs,
  type NextUpTrigger,
  nextUpTriggerAt,
  nextUpVisible,
  secondsLeft,
  ticked,
} from './next-up.ts'

const minutes = (value: number) => value * 60_000
const episodeMs = minutes(45)
const intro: MediaSegmentDto = { type: 'intro', startMs: 60_000, endMs: 150_000 }
const credits: MediaSegmentDto = { type: 'credits', startMs: minutes(43), endMs: minutes(44) }
const preview: MediaSegmentDto = { type: 'preview', startMs: minutes(44), endMs: episodeMs }

const at = (segments: readonly MediaSegmentDto[], positionMs: number, ended = false) =>
  nextUpTriggerAt({ segments, positionMs, totalMs: episodeMs, ended })

describe('nextUpTriggerAt', () => {
  test('entering the credits opens the card, seeking back out of them closes it', () => {
    expect(at([intro, credits], minutes(43))).toMatchObject({ kind: 'credits', segment: credits })
    expect(at([intro, credits], minutes(43) - 1)).toBeUndefined()
    expect(at([intro, credits], minutes(20))).toBeUndefined()
  })

  test('a preview counts as credits, with its own key', () => {
    const first = at([credits, preview], minutes(43) + 10)
    const second = at([credits, preview], minutes(44) + 10)
    expect(second).toMatchObject({ kind: 'credits', segment: preview })
    expect(first?.key).not.toBe(second?.key)
  })

  test('after the credits (a scene before the end), no card until the end of the file', () => {
    const early: MediaSegmentDto = { type: 'credits', startMs: minutes(40), endMs: minutes(42) }
    expect(at([early], minutes(44) + 30_000)).toBeUndefined()
    expect(at([early], episodeMs, true)).toEqual({ kind: 'end', key: 'end' })
  })

  test('without credits nor preview: the last 90 s (or 2 %), even with an intro', () => {
    expect(at([intro], episodeMs - 89_000)).toEqual({ kind: 'fallback', key: 'fallback' })
    expect(at([], episodeMs - 91_000)).toBeUndefined()
    const movieMs = minutes(150)
    expect(
      nextUpTriggerAt({
        segments: [],
        positionMs: movieMs - 170_000,
        totalMs: movieMs,
        ended: false,
      }),
    ).toEqual({ kind: 'fallback', key: 'fallback' })
  })

  test('an unknown duration has no fallback', () => {
    expect(nextUpTriggerAt({ segments: [], positionMs: 0, totalMs: 0, ended: false })).toBe(
      undefined,
    )
  })
})

describe('fallbackWindowMs', () => {
  test('90 s or 2 % of the duration, the larger', () => {
    expect(fallbackWindowMs(episodeMs)).toBe(90_000)
    expect(fallbackWindowMs(minutes(150))).toBe(180_000)
  })

  test('never more than 10 % of a short item', () => {
    expect(fallbackWindowMs(minutes(5))).toBe(30_000)
    expect(fallbackWindowMs(10_000)).toBe(1000)
    expect(fallbackWindowMs(0)).toBe(0)
  })
})

describe('countdown', () => {
  const creditsTrigger: NextUpTrigger = { kind: 'credits', key: 'credits:1', segment: credits }
  const end: NextUpTrigger = { kind: 'end', key: 'end' }

  test('10 s, 0 with autoSkipCredits, none with autoplayNext off', () => {
    expect(countdownStartMs({ autoplayNext: true, autoSkipCredits: false })).toBe(nextUpCountdownMs)
    expect(countdownStartMs({ autoplayNext: true, autoSkipCredits: true })).toBe(0)
    expect(countdownStartMs({ autoplayNext: false, autoSkipCredits: true })).toBeUndefined()
  })

  test('a trigger keeps its countdown, a new one starts over', () => {
    const started = countdownFor(undefined, creditsTrigger, 10_000)
    expect(started).toEqual({ key: 'credits:1', leftMs: 10_000 })
    const running = ticked(started, 2500)
    expect(countdownFor(running, creditsTrigger, 10_000)).toBe(running)
    expect(countdownFor(running, { kind: 'fallback', key: 'fallback' }, 10_000).leftMs).toBe(10_000)
  })

  test('the end of the file carries on the countdown of the credits it follows', () => {
    const running = ticked(countdownFor(undefined, creditsTrigger, 10_000), 7000)
    expect(countdownFor(running, end, 10_000)).toEqual({ key: 'end', leftMs: 3000 })
    expect(countdownFor(undefined, end, 10_000)).toEqual({ key: 'end', leftMs: 10_000 })
    expect(countdownFor({ key: 'credits:1', leftMs: undefined }, end, undefined).leftMs).toBe(
      undefined,
    )
  })

  test('ticks down to 0, never below; no countdown never ticks', () => {
    const countdown = { key: 'end', leftMs: 1200 }
    expect(ticked(countdown, 5000).leftMs).toBe(0)
    expect(ticked(countdown, -100).leftMs).toBe(1200)
    expect(ticked({ key: 'end', leftMs: undefined }, 5000).leftMs).toBeUndefined()
  })

  test('seconds shown rounded up, ring ratio of the start', () => {
    expect(secondsLeft({ key: 'end', leftMs: 8200 })).toBe(9)
    expect(secondsLeft({ key: 'end', leftMs: 0 })).toBe(0)
    expect(secondsLeft({ key: 'end', leftMs: undefined })).toBeUndefined()
    expect(countdownRatio({ key: 'end', leftMs: 2500 }, 10_000)).toBe(0.25)
    expect(countdownRatio({ key: 'end', leftMs: 0 }, 0)).toBe(0)
  })
})

describe('nextUpVisible', () => {
  const creditsTrigger: NextUpTrigger = { kind: 'credits', key: 'credits:1', segment: credits }

  test('"Regarder le générique" keeps it closed for that segment only', () => {
    const dismissed = new Set(['credits:1'])
    expect(nextUpVisible({ trigger: creditsTrigger, dismissed, next: 'found' })).toBe(false)
    expect(
      nextUpVisible({
        trigger: { ...creditsTrigger, key: 'preview:2' },
        dismissed,
        next: 'found',
      }),
    ).toBe(true)
  })

  test('the end of the file shows it again, when there is a next episode', () => {
    const dismissed = new Set(['credits:1'])
    const end: NextUpTrigger = { kind: 'end', key: 'end' }
    expect(nextUpVisible({ trigger: end, dismissed, next: 'found' })).toBe(true)
    expect(nextUpVisible({ trigger: end, dismissed, next: 'none' })).toBe(false)
  })

  test('no next episode (a movie): the card still opens in the credits', () => {
    expect(nextUpVisible({ trigger: creditsTrigger, dismissed: new Set(), next: 'none' })).toBe(
      true,
    )
  })

  test('nothing while the next episode is being looked up', () => {
    expect(nextUpVisible({ trigger: creditsTrigger, dismissed: new Set(), next: 'loading' })).toBe(
      false,
    )
    expect(nextUpVisible({ trigger: undefined, dismissed: new Set(), next: 'found' })).toBe(false)
  })
})
