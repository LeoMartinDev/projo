import { describe, expect, test } from 'bun:test'

import type { TvSnapshotCandidate } from './snapshot.ts'
import {
  type GrabPriorities,
  grabDueAtMs,
  grabEnded,
  grabStarted,
  initialSourceGrabState,
  isFreeSnapshotDue,
  pickSnapshotChannel,
  type SourceGrabState,
  sourceGrabBlock,
  snapshotTimings,
} from './snapshot-schedule.ts'

const minute = 60_000
const hour = 60 * minute
const now = Date.parse('2026-11-18T20:00:00.000Z')
const ago = (ms: number) => new Date(now - ms)

const candidate = (id: string, fields: Partial<TvSnapshotCandidate> = {}): TvSnapshotCandidate => ({
  id,
  failures: 0,
  ...fields,
})

const nobody: GrabPriorities = {
  visible: new Set<string>(),
  favorites: new Set<string>(),
  streaming: () => false,
}

describe('free snapshots from a running stream (§29.4)', () => {
  test('at most every 5 minutes per channel', () => {
    expect(isFreeSnapshotDue({ lastAtMs: undefined, nowMs: now })).toBe(true)
    expect(isFreeSnapshotDue({ lastAtMs: now - 4 * minute, nowMs: now })).toBe(false)
    expect(isFreeSnapshotDue({ lastAtMs: now - 5 * minute, nowMs: now })).toBe(true)
  })
})

describe('a channel due for a grab (§29.4)', () => {
  test('never snapshotted: at once; else 15 minutes after its snapshot', () => {
    expect(grabDueAtMs(candidate('a'))).toBe(Number.NEGATIVE_INFINITY)
    expect(grabDueAtMs(candidate('a', { snapshotAt: ago(10 * minute) }))).toBe(now + 5 * minute)
  })

  test('failures back off 1 hour, 6 hours, then 24 hours after the last attempt', () => {
    const failed = (failures: number) =>
      grabDueAtMs(candidate('a', { failures, attemptAt: ago(0), snapshotAt: ago(2 * hour) }))
    expect(failed(1)).toBe(now + hour)
    expect(failed(2)).toBe(now + 6 * hour)
    expect(failed(3)).toBe(now + 24 * hour)
    expect(failed(9)).toBe(now + 24 * hour)
  })
})

describe('the channel to grab next (§29.4)', () => {
  const pick = (
    candidates: TvSnapshotCandidate[],
    priorities: Partial<GrabPriorities> = {},
  ): string | undefined =>
    pickSnapshotChannel({ candidates, nowMs: now, priorities: { ...nobody, ...priorities } })?.id

  test('a page shows it, then a favourite, then watched in 7 days, then the rest', () => {
    const channels = [
      candidate('rest'),
      candidate('watched', { watchedAt: ago(3 * 24 * hour) }),
      candidate('favorite'),
      candidate('shown', { snapshotAt: ago(20 * minute) }),
    ]
    expect(pick(channels, { visible: new Set(['shown']), favorites: new Set(['favorite']) })).toBe(
      'shown',
    )
    expect(pick(channels, { favorites: new Set(['favorite']) })).toBe('favorite')
    expect(pick(channels)).toBe('watched')
    // Watched more than 7 days ago: one of the rest, in the page's order.
    expect(pick([candidate('rest'), candidate('old', { watchedAt: ago(8 * 24 * hour) })])).toBe(
      'rest',
    )
  })

  test('within a tier, never snapshotted first, then the oldest snapshot, then page order', () => {
    expect(
      pick([
        candidate('recent', { snapshotAt: ago(20 * minute) }),
        candidate('older', { snapshotAt: ago(50 * minute) }),
        candidate('never'),
        candidate('never-too'),
      ]),
    ).toBe('never')
    expect(
      pick([
        candidate('recent', { snapshotAt: ago(20 * minute) }),
        candidate('older', { snapshotAt: ago(50 * minute) }),
      ]),
    ).toBe('older')
  })

  test('neither a channel not due, backed off, nor one with a stream', () => {
    expect(
      pick(
        [
          candidate('fresh', { snapshotAt: ago(5 * minute) }),
          candidate('failing', { failures: 1, attemptAt: ago(30 * minute) }),
          candidate('streaming'),
        ],
        { streaming: (id) => id === 'streaming', visible: new Set(['fresh', 'failing']) },
      ),
    ).toBeUndefined()
  })
})

describe("a source's grabs (§29.4)", () => {
  const fresh = initialSourceGrabState(0)
  const block = (state: SourceGrabState, lastConnectionAtMs?: number, grabsPerHour = 60) =>
    sourceGrabBlock({ state, nowMs: now, grabsPerHour, lastConnectionAtMs })

  test('one at a time', () => {
    expect(block({ ...fresh, running: true })).toBe('running')
    expect(block(fresh)).toBeUndefined()
  })

  test('the budget: fewer grabs started in the last hour than allowed', () => {
    const started = Array.from({ length: 3 }, (_, index) => now - (index + 1) * 10 * minute)
    expect(block({ ...fresh, startedAtMs: started }, undefined, 3)).toBe('budget')
    expect(block({ ...fresh, startedAtMs: started }, undefined, 4)).toBeUndefined()
    // A grab started an hour ago no longer counts.
    expect(block({ ...fresh, startedAtMs: [now - hour, now - 2 * minute] }, undefined, 2)).toBe(
      undefined,
    )
  })

  test('10 s plus a random part up to 5 s since the source last opened a connection', () => {
    expect(initialSourceGrabState(0).gapMs).toBe(10_000)
    expect(initialSourceGrabState(0.999).gapMs).toBe(14_995)
    const state = initialSourceGrabState(0.5)
    expect(state.gapMs).toBe(12_500)
    expect(block(state, now - 12_000)).toBe('spacing')
    expect(block(state, now - 12_500)).toBeUndefined()
  })

  test('starting one counts it and draws a new spacing', () => {
    const started = grabStarted({ ...fresh, startedAtMs: [now - 2 * hour, now - minute] }, now, 1)
    expect(started).toMatchObject({
      running: true,
      startedAtMs: [now - minute, now],
      gapMs: snapshotTimings.sourceGapMs + snapshotTimings.jitterMs,
    })
  })

  test('three consecutive refusals pause the source an hour; a success resets them', () => {
    const running = { ...fresh, running: true }
    const once = grabEnded(running, { ok: false, reason: 'refused' }, now)
    expect(once).toEqual({ state: { ...fresh, refusals: 1 }, paused: false })
    const twice = grabEnded({ ...once.state, running: true }, { ok: false, reason: 'timeout' }, now)
    // Any other failure leaves the count.
    const other = grabEnded({ ...twice.state, running: true }, { ok: false, reason: 'failed' }, now)
    expect(other.state.refusals).toBe(2)
    const thrice = grabEnded(
      { ...other.state, running: true },
      { ok: false, reason: 'refused' },
      now,
    )
    expect(thrice.paused).toBe(true)
    expect(thrice.state).toMatchObject({ refusals: 0, pausedUntilMs: now + hour, running: false })
    expect(block(thrice.state)).toBe('paused')
    expect(
      sourceGrabBlock({
        state: thrice.state,
        nowMs: now + hour,
        grabsPerHour: 60,
        lastConnectionAtMs: undefined,
      }),
    ).toBeUndefined()
    const reset = grabEnded({ ...twice.state, running: true }, { ok: true }, now)
    expect(reset.state.refusals).toBe(0)
  })

  test('a grab stopped (evicted, turned off) changes nothing but its end', () => {
    const ended = grabEnded({ ...fresh, running: true, refusals: 2 }, { stopped: true }, now)
    expect(ended).toEqual({ state: { ...fresh, refusals: 2 }, paused: false })
  })
})
