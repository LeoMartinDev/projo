import { describe, expect, test } from 'bun:test'

import { SEEK_STALL_MS, type SeekableMedia, watchSeekStalls } from './seek-stall.ts'

const ranges = (...spans: [number, number][]): TimeRanges => ({
  length: spans.length,
  start: (index) => spans[index]?.[0] ?? 0,
  end: (index) => spans[index]?.[1] ?? 0,
})

/** A `<video>` whose seeks end only when the test says so, and timers run by hand. */
const world = (buffered: TimeRanges) => {
  const target = new EventTarget()
  const seeks: number[] = []
  let time = 0
  const media = {
    seeking: false,
    buffered,
    get currentTime() {
      return time
    },
    set currentTime(seconds: number) {
      time = seconds
      seeks.push(seconds)
      media.seeking = true
      target.dispatchEvent(new Event('seeking'))
    },
    addEventListener: target.addEventListener.bind(target),
    removeEventListener: target.removeEventListener.bind(target),
  }
  const timers: { run: () => void; ms: number; cancelled: boolean }[] = []
  const stop = watchSeekStalls(media as unknown as SeekableMedia, {
    delay: (run, ms) => {
      const timer = { run, ms, cancelled: false }
      timers.push(timer)
      return () => {
        timer.cancelled = true
      }
    },
  })
  const elapse = () => {
    for (const timer of timers.splice(0)) if (!timer.cancelled) timer.run()
  }
  const seeked = () => {
    media.seeking = false
    target.dispatchEvent(new Event('seeked'))
  }
  return { media, seeks, timers, elapse, seeked, stop }
}

describe('seek stall watchdog', () => {
  test('a buffered seek still pending after the delay is made again, at the same time', () => {
    const { media, seeks, timers, elapse } = world(ranges([0.021, 4.032]))
    media.currentTime = 0.7
    expect(timers.map(({ ms }) => ms)).toEqual([SEEK_STALL_MS])
    elapse()
    expect(seeks).toEqual([0.7, 0.7])
    // Still stuck: tried again.
    elapse()
    expect(seeks).toEqual([0.7, 0.7, 0.7])
  })

  test('a seek that ends in time is left alone', () => {
    const { media, seeks, elapse, seeked } = world(ranges([0, 4]))
    media.currentTime = 2
    seeked()
    elapse()
    expect(seeks).toEqual([2])
  })

  test('a seek waiting for its data (not buffered yet) is left alone', () => {
    const { media, seeks, elapse } = world(ranges([0, 4]))
    media.currentTime = 30
    elapse()
    expect(seeks).toEqual([30])
  })

  test('after the cleanup, nothing is retried', () => {
    const { media, seeks, elapse, stop } = world(ranges([0, 4]))
    media.currentTime = 1
    stop()
    elapse()
    media.currentTime = 2
    elapse()
    expect(seeks).toEqual([1, 2])
  })
})
