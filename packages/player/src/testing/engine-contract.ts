import { describe, expect, test } from 'bun:test'

import type { EngineLoad, PlayerEngine } from '../core/engine.ts'
import type { MediaEventType } from '../core/media-state.ts'
import { contractDurationS, contractLoad } from './contract-session.ts'

/**
 * Moves the media under an engine the way a real stream would. For a real
 * engine it drives the underlying player (or replays recorded sequences of
 * it); every step may be asynchronous.
 */
export type EngineDriver = {
  // The loaded stream's metadata arrives (a stream of `durationS` seconds).
  loaded: (durationS: number) => void | Promise<void>
  // `seconds` of playback.
  advance: (seconds: number) => void | Promise<void>
  // The data runs out, then comes back.
  stall: () => void | Promise<void>
  resume: () => void | Promise<void>
  // Lets the engine's pending work and events run.
  settle?: () => void | Promise<void>
}

export type EngineUnderTest = { engine: PlayerEngine; driver: EngineDriver }

const recorder = (engine: PlayerEngine) => {
  const events: MediaEventType[] = []
  const stop = engine.events.subscribe((event) => events.push(event.type))
  const before = (first: MediaEventType, second: MediaEventType) => {
    const a = events.indexOf(first)
    const b = events.lastIndexOf(second)
    return a !== -1 && b !== -1 && a < b
  }
  return { events, stop, before, clear: () => void events.splice(0) }
}

/**
 * The behaviour the player controller relies on, for any engine: run it with
 * a factory of the engine under test and its driver.
 */
export const runEngineContract = (name: string, create: () => EngineUnderTest): void => {
  const loaded = async (
    { engine, driver }: EngineUnderTest,
    load: Partial<EngineLoad> = {},
    durationS = contractDurationS,
  ) => {
    const failures: string[] = []
    const unload = engine.load(contractLoad(load), (failure) => failures.push(failure.message))
    await driver.loaded(durationS)
    await driver.settle?.()
    return { unload, failures }
  }

  describe(`engine contract: ${name}`, () => {
    test('load: waiting without metadata, then the metadata before playback', async () => {
      const subject = create()
      const { engine } = subject
      const recorded = recorder(engine)
      expect(engine.state.get().waiting).toBe(true)
      await loaded(subject)
      const state = engine.state.get()
      expect(state).toMatchObject({ ready: true, paused: false, waiting: false, duration: 60 })
      expect(recorded.before('loadedmetadata', 'playing')).toBe(true)
      expect(recorded.before('play', 'playing')).toBe(true)
      recorded.stop()
    })

    test('load: the start position is reached before playback starts', async () => {
      const subject = create()
      const recorded = recorder(subject.engine)
      await loaded(subject, { startSeconds: 20 })
      expect(subject.engine.read().currentTime).toBeCloseTo(20, 0)
      expect(recorded.before('seeked', 'playing')).toBe(true)
      recorded.stop()
    })

    test('load without autoplay stays paused, not waiting once it can play', async () => {
      const subject = create()
      await loaded(subject, { autoplay: false })
      expect(subject.engine.state.get()).toMatchObject({ paused: true, ready: true })
      expect(subject.engine.state.get().waiting).toBe(false)
    })

    test('pause then play: `pause`, then `play` before `playing`', async () => {
      const subject = create()
      const { engine, driver } = subject
      await loaded(subject)
      const recorded = recorder(engine)
      engine.pause()
      await driver.settle?.()
      expect(recorded.events).toContain('pause')
      expect(engine.state.get()).toMatchObject({ paused: true, waiting: false })
      recorded.clear()
      engine.play()
      await driver.settle?.()
      expect(recorded.before('play', 'playing')).toBe(true)
      expect(engine.state.get().paused).toBe(false)
      recorded.stop()
    })

    test('seek: `seeking` then `seeked`, at the target, clamped to the duration', async () => {
      const subject = create()
      const { engine, driver } = subject
      await loaded(subject)
      const recorded = recorder(engine)
      engine.seek(30)
      await driver.settle?.()
      expect(recorded.before('seeking', 'seeked')).toBe(true)
      expect(engine.read().currentTime).toBeCloseTo(30, 0)
      expect(engine.state.get()).toMatchObject({ seeking: false, waiting: false })
      engine.seek(600)
      await driver.settle?.()
      expect(engine.read().currentTime).toBeLessThanOrEqual(60)
      engine.seek(-5)
      await driver.settle?.()
      expect(engine.read().currentTime).toBe(0)
      recorded.stop()
    })

    test('buffering: a stall is waiting until the data comes back', async () => {
      const subject = create()
      const { engine, driver } = subject
      await loaded(subject)
      await driver.stall()
      expect(engine.state.get().waiting).toBe(true)
      await driver.resume()
      expect(engine.state.get().waiting).toBe(false)
    })

    test('end: time moves, then `pause` and `ended`, the state ended and paused', async () => {
      const subject = create()
      const { engine, driver } = subject
      await loaded(subject)
      const recorded = recorder(engine)
      await driver.advance(5)
      expect(recorded.events).toContain('timeupdate')
      expect(engine.state.get().currentTime).toBeCloseTo(5, 0)
      await driver.advance(60)
      expect(recorded.events.at(-1)).toBe('ended')
      expect(engine.state.get()).toMatchObject({ ended: true, paused: true })
      recorded.stop()
    })

    test('volume and rate come back as events and state', async () => {
      const subject = create()
      const { engine, driver } = subject
      await loaded(subject)
      const recorded = recorder(engine)
      engine.setVolume(0.5, false)
      engine.setRate(1.5)
      await driver.settle?.()
      expect(recorded.events).toContain('volumechange')
      expect(engine.state.get()).toMatchObject({ volume: 0.5, muted: false, playbackRate: 1.5 })
      engine.setVolume(0.5, true)
      await driver.settle?.()
      expect(engine.state.get().muted).toBe(true)
      recorded.stop()
    })

    test('unload: the media empties, no failure is reported after it', async () => {
      const subject = create()
      const { engine, driver } = subject
      const { unload, failures } = await loaded(subject)
      unload()
      await driver.settle?.()
      expect(engine.state.get()).toMatchObject({ ready: false, waiting: true })
      expect(failures).toEqual([])
    })
  })
}
