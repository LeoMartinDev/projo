import { describe, expect, test } from 'bun:test'

import type { MediaSegmentDto } from '@projo/shared/api/playback'

import {
  type Countdown,
  countdownFor,
  countdownRatio,
  countdownRuns,
  countdownStartMs,
  fallbackWindowMs,
  nextUpCountdownMs,
  nextUpLaunches,
  nextUpShortCountdownMs,
  type NextUpTrigger,
  nextUpTriggerAt,
  nextUpViewFor,
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
  test('entering the credits triggers next, seeking back out of them stops it', () => {
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

  test('after the credits (a scene before the end), nothing until the end of the file', () => {
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

describe('nextUpViewFor', () => {
  const creditsTrigger: NextUpTrigger = { kind: 'credits', key: 'credits:1', segment: credits }
  const fallback: NextUpTrigger = { kind: 'fallback', key: 'fallback' }
  const end: NextUpTrigger = { kind: 'end', key: 'end' }
  const view = (
    trigger: NextUpTrigger | undefined,
    {
      creditsDismissed = false,
      next = 'found',
      blocked = false,
    }: {
      creditsDismissed?: boolean
      next?: 'loading' | 'none' | 'found'
      blocked?: boolean
    } = {},
  ) => nextUpViewFor({ trigger, creditsDismissed, next, blocked })

  test('the credits and the fallback window show the bubble, the end of the file the screen', () => {
    expect(view(creditsTrigger)).toBe('bubble')
    expect(view(fallback)).toBe('bubble')
    expect(view(end)).toBe('screen')
    expect(view(undefined)).toBe('none')
  })

  test('"Watch the credits" hides the bubble for the episode, the end screen still follows', () => {
    expect(view(creditsTrigger, { creditsDismissed: true })).toBe('none')
    expect(view({ ...creditsTrigger, key: 'preview:2' }, { creditsDismissed: true })).toBe('none')
    expect(view(end, { creditsDismissed: true })).toBe('screen')
  })

  test('no next episode (a movie, the last episode): neither bubble nor screen', () => {
    expect(view(creditsTrigger, { next: 'none' })).toBe('none')
    expect(view(end, { next: 'none' })).toBe('none')
  })

  test('nothing while the next episode is looked up, nor over a blocking error', () => {
    expect(view(creditsTrigger, { next: 'loading' })).toBe('none')
    expect(view(creditsTrigger, { blocked: true })).toBe('none')
    expect(view(end, { blocked: true })).toBe('none')
  })
})

describe('countdown', () => {
  const creditsTrigger: NextUpTrigger = { kind: 'credits', key: 'credits:1', segment: credits }
  const previewTrigger: NextUpTrigger = { kind: 'credits', key: 'preview:2', segment: preview }
  const end: NextUpTrigger = { kind: 'end', key: 'end' }

  test('10 s, 5 s with autoSkipCredits (never 0), none with autoplayNext off', () => {
    expect(countdownStartMs({ autoplayNext: true, autoSkipCredits: false })).toBe(nextUpCountdownMs)
    expect(countdownStartMs({ autoplayNext: true, autoSkipCredits: true })).toBe(
      nextUpShortCountdownMs,
    )
    expect(nextUpShortCountdownMs).toBeGreaterThan(0)
    expect(countdownStartMs({ autoplayNext: false, autoSkipCredits: true })).toBeUndefined()
  })

  test('the credits keep one countdown, even into a preview right after them', () => {
    const started = countdownFor(undefined, creditsTrigger, 10_000)
    expect(started).toEqual({ phase: 'credits', leftMs: 10_000 })
    const running = ticked(started, 2500)
    expect(countdownFor(running, creditsTrigger, 10_000)).toBe(running)
    expect(countdownFor(running, previewTrigger, 10_000)).toBe(running)
  })

  test('dropped (seek back, "Watch the credits"), it starts over', () => {
    expect(countdownFor(undefined, creditsTrigger, 5000)).toEqual({
      phase: 'credits',
      leftMs: 5000,
    })
  })

  test('the end of the file carries on the countdown of the credits it follows', () => {
    const running = ticked(countdownFor(undefined, creditsTrigger, 10_000), 7000)
    expect(countdownFor(running, end, 10_000)).toEqual({ phase: 'end', leftMs: 3000 })
    expect(countdownFor(undefined, end, 10_000)).toEqual({ phase: 'end', leftMs: 10_000 })
    expect(countdownFor({ phase: 'credits', leftMs: undefined }, end, undefined).leftMs).toBe(
      undefined,
    )
  })

  test('ticks down to 0, never below; no countdown never ticks', () => {
    const countdown: Countdown = { phase: 'end', leftMs: 1200 }
    expect(ticked(countdown, 5000).leftMs).toBe(0)
    expect(ticked(countdown, -100).leftMs).toBe(1200)
    expect(ticked({ phase: 'end', leftMs: undefined }, 5000).leftMs).toBeUndefined()
  })

  test('seconds shown rounded up, ring ratio of the start', () => {
    expect(secondsLeft({ phase: 'end', leftMs: 8200 })).toBe(9)
    expect(secondsLeft({ phase: 'end', leftMs: 0 })).toBe(0)
    expect(secondsLeft({ phase: 'end', leftMs: undefined })).toBeUndefined()
    expect(countdownRatio({ phase: 'end', leftMs: 2500 }, 10_000)).toBe(0.25)
    expect(countdownRatio({ phase: 'end', leftMs: 0 }, 0)).toBe(0)
  })
})

describe('countdownRuns', () => {
  const counting: Countdown = { phase: 'credits', leftMs: 4000 }
  const runs = (view: 'none' | 'bubble' | 'screen', countdown: Countdown, paused = false) =>
    countdownRuns({ view, countdown, paused, ended: false })

  test('runs under the bubble while the video plays (controls or not, PiP), held by a pause', () => {
    expect(runs('bubble', counting)).toBe(true)
    expect(runs('bubble', counting, true)).toBe(false)
  })

  test('runs on the end screen although the ended video reports paused', () => {
    expect(
      countdownRuns({
        view: 'screen',
        countdown: { phase: 'end', leftMs: 4000 },
        paused: true,
        ended: true,
      }),
    ).toBe(true)
  })

  test('nothing to run: no view, no countdown (autoplay off), or already at 0', () => {
    expect(runs('none', counting)).toBe(false)
    expect(runs('bubble', { phase: 'credits', leftMs: undefined })).toBe(false)
    expect(runs('bubble', { phase: 'credits', leftMs: 0 })).toBe(false)
  })
})

describe('nextUpLaunches', () => {
  test('the next episode starts when a shown countdown reaches 0', () => {
    expect(nextUpLaunches('bubble', { phase: 'credits', leftMs: 0 })).toBe(true)
    expect(nextUpLaunches('screen', { phase: 'end', leftMs: 0 })).toBe(true)
    expect(nextUpLaunches('bubble', { phase: 'credits', leftMs: 300 })).toBe(false)
    expect(nextUpLaunches('bubble', { phase: 'credits', leftMs: undefined })).toBe(false)
    expect(nextUpLaunches('none', { phase: 'credits', leftMs: 0 })).toBe(false)
  })
})
