import { describe, expect, test } from 'bun:test'

import type { TapZone } from './shortcuts.ts'
import {
  doubleTapMs,
  idleGesture,
  seekSeriesMs,
  settled,
  type TapGesture,
  type TapStep,
  tapped,
} from './tap-gestures.ts'

// Plays taps given as [time, zone] from idle, settling whenever the gap to the
// next tap is longer than the pending wait; returns each tap's step and every
// controls toggle.
const play = (taps: [number, TapZone][]) => {
  let gesture: TapGesture = idleGesture
  let deadline = Number.POSITIVE_INFINITY
  let toggles = 0
  const steps: TapStep[] = []
  const settle = () => {
    const result = settled(gesture)
    gesture = result.gesture
    if (result.toggleControls) toggles += 1
  }
  for (const [time, zone] of taps) {
    if (time > deadline) settle()
    const step = tapped(gesture, { time, zone })
    steps.push(step)
    gesture = step.gesture
    deadline = time + step.settleAfterMs
  }
  settle()
  return { steps, toggles, seeks: steps.flatMap((step) => (step.seek ? [step.seek] : [])) }
}

describe('tap gestures', () => {
  test('a single tap toggles the controls only once the double tap window has passed', () => {
    const step = tapped(idleGesture, { time: 1000, zone: 'left' })
    expect(step.seek).toBeUndefined()
    expect(step.settleAfterMs).toBe(doubleTapMs)
    expect(settled(step.gesture).toggleControls).toBe(true)
    expect(play([[1000, 'center']])).toMatchObject({ toggles: 1, seeks: [] })
  })

  test('a double tap on a side seeks one step and never toggles the controls', () => {
    expect(
      play([
        [1000, 'right'],
        [1000 + doubleTapMs, 'right'],
      ]),
    ).toMatchObject({ toggles: 0, seeks: [{ side: 'right', steps: 1 }] })
    expect(
      play([
        [1000, 'left'],
        [1120, 'left'],
      ]),
    ).toMatchObject({ toggles: 0, seeks: [{ side: 'left', steps: 1 }] })
  })

  test('a slow second tap is two single taps', () => {
    expect(
      play([
        [1000, 'left'],
        [1000 + doubleTapMs + 1, 'left'],
      ]),
    ).toMatchObject({ toggles: 2, seeks: [] })
  })

  test('the middle third never seeks', () => {
    expect(
      play([
        [1000, 'center'],
        [1100, 'center'],
        [1200, 'center'],
      ]),
    ).toMatchObject({ toggles: 1, seeks: [] })
  })

  test('taps on two different sides are no double tap', () => {
    expect(
      play([
        [1000, 'left'],
        [1100, 'right'],
      ]),
    ).toMatchObject({ toggles: 1, seeks: [] })
  })

  test('every further tap on the same side adds a step while they keep coming', () => {
    const { seeks, toggles } = play([
      [1000, 'right'],
      [1150, 'right'],
      [1500, 'right'],
      [1500 + seekSeriesMs, 'right'],
    ])
    expect(toggles).toBe(0)
    expect(seeks).toEqual([
      { side: 'right', steps: 1 },
      { side: 'right', steps: 2 },
      { side: 'right', steps: 3 },
    ])
  })

  test('the series ends after a pause, and the next tap is a single tap again', () => {
    const { seeks, toggles, steps } = play([
      [1000, 'left'],
      [1150, 'left'],
      [1150 + seekSeriesMs + 1, 'left'],
    ])
    expect(seeks).toEqual([{ side: 'left', steps: 1 }])
    expect(steps[1]?.settleAfterMs).toBe(seekSeriesMs)
    expect(toggles).toBe(1)
  })

  test('a tap on the other side during a series starts a series there', () => {
    expect(
      play([
        [1000, 'left'],
        [1150, 'left'],
        [1400, 'left'],
        [1700, 'right'],
        [1900, 'right'],
      ]).seeks,
    ).toEqual([
      { side: 'left', steps: 1 },
      { side: 'left', steps: 2 },
      { side: 'right', steps: 1 },
      { side: 'right', steps: 2 },
    ])
  })

  test('a tap in the middle ends a series and waits as a single tap', () => {
    const { seeks, toggles } = play([
      [1000, 'right'],
      [1150, 'right'],
      [1400, 'center'],
    ])
    expect(seeks).toEqual([{ side: 'right', steps: 1 }])
    expect(toggles).toBe(1)
  })
})
