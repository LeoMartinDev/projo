import { describe, expect, test } from 'bun:test'

import {
  type Pinch,
  type PinchPoint,
  pinchCloseScale,
  pinchCloses,
  pinchMinScale,
  pinchMoved,
  pinchScale,
  pinchStarted,
  pinchVelocity,
  velocityWindowMs,
} from './pinch-gesture.ts'

// Two fingers on a horizontal line, `gap` pixels apart around x = 200.
const fingers = (gap: number): [PinchPoint, PinchPoint] => [
  { x: 200 - gap / 2, y: 300 },
  { x: 200 + gap / 2, y: 300 },
]

// Starts a pinch 400 px wide at time 0 and moves it through [time, gap] steps.
const pinch = (moves: [number, number][]): Pinch =>
  moves.reduce<Pinch>(
    (current, [time, gap]) => pinchMoved(current, ...fingers(gap), time),
    pinchStarted(...fingers(400), 0),
  )

describe('pinch gesture', () => {
  test('the scale follows the distance between the fingers', () => {
    expect(pinch([[100, 300]]).scale).toBe(0.75)
    expect(pinch([[100, 200]]).scale).toBe(0.5)
    const diagonal = pinchStarted({ x: 0, y: 0 }, { x: 300, y: 400 }, 0)
    expect(pinchMoved(diagonal, { x: 0, y: 0 }, { x: 150, y: 200 }, 50).scale).toBe(0.5)
  })

  test('pinching out never grows the video past full size', () => {
    expect(pinch([[100, 800]]).scale).toBe(1)
    expect(pinchScale(400, 1000)).toBe(1)
  })

  test('the video never shrinks below the minimum scale', () => {
    expect(pinch([[100, 20]]).scale).toBe(pinchMinScale)
    expect(pinchScale(400, 0)).toBe(pinchMinScale)
  })

  test('fingers that start on the same point keep the video at full size', () => {
    expect(pinchScale(0, 120)).toBe(1)
  })

  test('letting go at or below the threshold closes', () => {
    const slow = pinch([
      [400, 350],
      [800, 300],
      [1200, 280],
    ])
    expect(slow.scale).toBeLessThanOrEqual(pinchCloseScale)
    expect(pinchCloses(slow, 1500)).toBe(true)
  })

  test('letting go above the threshold after a slow pinch brings the video back', () => {
    const slow = pinch([
      [300, 380],
      [600, 360],
      [900, 340],
    ])
    expect(slow.scale).toBeGreaterThan(pinchCloseScale)
    expect(pinchCloses(slow, 950)).toBe(false)
  })

  test('a fast pinch closes before the threshold', () => {
    const fast = pinch([
      [20, 390],
      [40, 375],
      [60, 360],
    ])
    expect(fast.scale).toBeGreaterThan(pinchCloseScale)
    expect(pinchVelocity(fast, 70)).toBeLessThan(-1.5)
    expect(pinchCloses(fast, 70)).toBe(true)
  })

  test('a fast pinch held still before letting go no longer counts as fast', () => {
    const held = pinch([
      [20, 390],
      [40, 375],
      [60, 360],
    ])
    expect(pinchVelocity(held, 60 + velocityWindowMs + 1)).toBe(0)
    expect(pinchCloses(held, 60 + velocityWindowMs + 1)).toBe(false)
  })

  test('fingers opening again fast after closing bring the video back', () => {
    const reopened = pinch([
      [300, 330],
      [340, 350],
      [380, 380],
    ])
    expect(pinchVelocity(reopened, 390)).toBeGreaterThan(0)
    expect(pinchCloses(reopened, 390)).toBe(false)
  })

  test('two fingers lifted without moving do nothing', () => {
    expect(pinchCloses(pinchStarted(...fingers(400), 0), 80)).toBe(false)
    expect(pinchCloses(pinch([[40, 400]]), 80)).toBe(false)
  })
})
