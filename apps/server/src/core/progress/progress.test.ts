import { describe, expect, test } from 'bun:test'

import {
  aggregateWatchStatus,
  applyPosition,
  type ItemProgress,
  markUnwatched,
  markWatched,
  progressState,
  resumePositionMs,
} from './progress.ts'

const t0 = new Date('2026-03-01T20:00:00.000Z')
const later = (minutes: number) => new Date(t0.getTime() + minutes * 60_000)
const ids = { profileId: 'p', itemId: 'i' }
const hour = 3_600_000

const play = (previous: ItemProgress | undefined, positionMs: number, at = t0) =>
  applyPosition(previous, { ...ids, positionMs, durationMs: hour, at })

describe('§13.1 progress rules', () => {
  test('below 2 %: not resumable, unwatched', () => {
    const progress = play(undefined, 60_000)
    expect(progressState(progress)).toBe('unwatched')
    expect(resumePositionMs(progress)).toBe(0)
    expect(progress.playCount).toBe(0)
  })

  test('between 2 % and 93 %: "Reprendre" at the position', () => {
    const progress = play(undefined, 30 * 60_000)
    expect(progressState(progress)).toBe('in_progress')
    expect(resumePositionMs(progress)).toBe(30 * 60_000)
    expect(progress.watched).toBe(false)
  })

  test('93 % marks watched once, play_count + 1, resume from 0', () => {
    const halfway = play(undefined, 30 * 60_000)
    const end = play(halfway, 0.93 * hour, later(30))
    expect(end).toMatchObject({ watched: true, playCount: 1, watchedAt: later(30) })
    expect(progressState(end)).toBe('watched')
    expect(resumePositionMs(end)).toBe(0)
    // Heartbeats keep coming during the credits: no double count.
    const credits = play(end, 0.99 * hour, later(33))
    expect(credits).toMatchObject({ playCount: 1, watchedAt: later(30) })
  })

  test('a rewatch shows its own progress and counts again at 93 %', () => {
    const watched = play(play(undefined, 0.5 * hour), 0.95 * hour)
    const rewatch = play(watched, 0.4 * hour, later(60))
    expect(rewatch.watched).toBe(true)
    expect(progressState(rewatch)).toBe('in_progress')
    expect(resumePositionMs(rewatch)).toBe(0.4 * hour)
    expect(play(rewatch, 0.94 * hour, later(90)).playCount).toBe(2)
  })

  test('position beyond the duration is clamped; last_played_at follows; hidden flag reset', () => {
    const hidden = { ...play(undefined, 10 * 60_000), hiddenFromContinue: true }
    const progress = play(hidden, 2 * hour, later(5))
    expect(progress).toMatchObject({
      positionMs: hour,
      lastPlayedAt: later(5),
      hiddenFromContinue: false,
    })
  })

  test('manual watched: position back to 0, counted, idempotent', () => {
    const watched = markWatched(play(undefined, 0.5 * hour), { ...ids, at: later(1) })
    expect(watched).toMatchObject({
      watched: true,
      positionMs: 0,
      playCount: 1,
      watchedAt: later(1),
    })
    expect(markWatched(watched, { ...ids, at: later(2) })).toBe(watched)
    expect(markWatched(undefined, { ...ids, at: t0 })).toMatchObject({
      watched: true,
      playCount: 1,
    })
  })

  test('manual unwatched: position 0, watched cleared, history kept', () => {
    const unwatched = markUnwatched(play(play(undefined, 0.5 * hour), 0.97 * hour))
    expect(unwatched).toMatchObject({ watched: false, positionMs: 0, playCount: 1 })
    expect(unwatched.watchedAt).toBeUndefined()
    expect(progressState(unwatched)).toBe('unwatched')
  })
})

describe('§12.4 "vu" on entering the credits', () => {
  const creditsStartMs = 0.85 * hour
  const watch = (previous: ItemProgress | undefined, positionMs: number, at = t0) =>
    applyPosition(previous, { ...ids, positionMs, durationMs: hour, at, creditsStartMs })

  test('entering the credits before 93 % marks watched, stored at the end', () => {
    const halfway = watch(undefined, 0.5 * hour)
    const credits = watch(halfway, creditsStartMs, later(20))
    expect(credits).toMatchObject({
      watched: true,
      playCount: 1,
      watchedAt: later(20),
      positionMs: hour,
    })
    expect(progressState(credits)).toBe('watched')
    expect(resumePositionMs(credits)).toBe(0)
  })

  test('heartbeats in the credits, then 93 %: counted once', () => {
    const credits = watch(watch(undefined, 0.5 * hour), 0.86 * hour, later(20))
    const later93 = watch(watch(credits, 0.9 * hour, later(22)), 0.95 * hour, later(25))
    expect(later93).toMatchObject({ playCount: 1, watchedAt: later(20) })
  })

  test('seeking back before the credits: in progress again, a rewatch counts again', () => {
    const credits = watch(watch(undefined, 0.5 * hour), 0.9 * hour)
    const back = watch(credits, 0.6 * hour, later(1))
    expect(back.positionMs).toBe(0.6 * hour)
    expect(progressState(back)).toBe('in_progress')
    expect(watch(back, 0.88 * hour, later(2)).playCount).toBe(2)
  })

  test('first of 93 % and credits: credits after 93 % change nothing', () => {
    const late = (positionMs: number, previous?: ItemProgress) =>
      applyPosition(previous, {
        ...ids,
        positionMs,
        durationMs: hour,
        at: t0,
        creditsStartMs: 0.97 * hour,
      })
    const at93 = late(0.94 * hour, late(0.5 * hour))
    expect(at93).toMatchObject({ watched: true, playCount: 1, positionMs: 0.94 * hour })
    expect(late(0.98 * hour, at93)).toMatchObject({ playCount: 1, positionMs: hour })
  })

  test('a credits segment before half the duration is not trusted', () => {
    const early = applyPosition(undefined, {
      ...ids,
      positionMs: 0.3 * hour,
      durationMs: hour,
      at: t0,
      creditsStartMs: 0.2 * hour,
    })
    expect(early).toMatchObject({ watched: false, positionMs: 0.3 * hour })
  })

  test('a progress stored inside the credits before the segment was known still counts', () => {
    const before = play(undefined, 0.9 * hour)
    expect(before.watched).toBe(false)
    expect(watch(before, 0.9 * hour, later(1))).toMatchObject({ watched: true, playCount: 1 })
  })
})

describe('aggregateWatchStatus', () => {
  const watched = play(play(undefined, 0.5 * hour), 0.95 * hour)
  const inProgress = play(undefined, 0.5 * hour)

  test('no episode or nothing seen: unwatched', () => {
    expect(aggregateWatchStatus([])).toMatchObject({ state: 'unwatched', totalCount: 0 })
    expect(aggregateWatchStatus([undefined, undefined]).state).toBe('unwatched')
  })

  test('some seen or started: partial', () => {
    expect(aggregateWatchStatus([watched, undefined])).toEqual({
      state: 'partial',
      watchedCount: 1,
      inProgressCount: 0,
      totalCount: 2,
    })
    expect(aggregateWatchStatus([inProgress, undefined]).state).toBe('partial')
  })

  test('all watched: watched', () => {
    expect(aggregateWatchStatus([watched, watched]).state).toBe('watched')
  })
})
