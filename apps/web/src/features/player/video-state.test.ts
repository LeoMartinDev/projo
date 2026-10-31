import { describe, expect, test } from 'bun:test'

import { createFullscreenScope, createVideoStore, fullscreenAction } from './video-state.ts'

/** A playing `<video>` whose time and events the test drives. */
const world = () => {
  const target = new EventTarget()
  const video = {
    paused: false,
    ended: false,
    seeking: false,
    currentTime: 0,
    duration: 60,
    buffered: { length: 0, start: () => 0, end: () => 0 },
    volume: 1,
    muted: false,
    readyState: 4,
    addEventListener: target.addEventListener.bind(target),
    removeEventListener: target.removeEventListener.bind(target),
  }
  const store = createVideoStore(video as unknown as HTMLVideoElement)
  store.subscribe(() => {})
  const fire = (type: string) => target.dispatchEvent(new Event(type))
  return { video, store, fire }
}

describe('video state', () => {
  test('a stall that resumes without `playing` stops waiting once time moves', () => {
    const { video, store, fire } = world()
    fire('playing')
    video.currentTime = 5
    fire('timeupdate')
    fire('waiting')
    expect(store.getSnapshot().waiting).toBe(true)
    // Same time reported while stalled: still waiting.
    fire('timeupdate')
    expect(store.getSnapshot().waiting).toBe(true)
    video.currentTime = 5.25
    fire('timeupdate')
    expect(store.getSnapshot().waiting).toBe(false)
  })

  test('the time jump of a seek in progress is not playback', () => {
    const { video, store, fire } = world()
    video.seeking = true
    fire('seeking')
    video.currentTime = 30
    fire('timeupdate')
    expect(store.getSnapshot().waiting).toBe(true)
  })
})

describe('fullscreen across episodes (§10.7)', () => {
  test('the document goes fullscreen where it can, the video only on iOS Safari', () => {
    const can = { documentFullscreen: true, videoFullscreen: true }
    expect(fullscreenAction({ active: false, ...can })).toBe('document')
    expect(fullscreenAction({ active: true, ...can })).toBe('exit')
    expect(
      fullscreenAction({ active: false, documentFullscreen: false, videoFullscreen: true }),
    ).toBe('video')
    expect(
      fullscreenAction({ active: false, documentFullscreen: false, videoFullscreen: false }),
    ).toBe('none')
  })

  test('the next episode keeps it; leaving the player ends it', () => {
    let exits = 0
    const ticks: (() => void)[] = []
    const scope = createFullscreenScope({
      exit: () => {
        exits += 1
      },
      defer: (callback) => void ticks.push(callback),
    })
    const tick = () => {
      for (const run of ticks.splice(0)) run()
    }
    const leaveFirst = scope.enter()
    // `<PlayerPage key={itemId}>`: the old player unmounts as the next one mounts.
    leaveFirst()
    const leaveSecond = scope.enter()
    tick()
    expect(exits).toBe(0)
    leaveSecond()
    tick()
    expect(exits).toBe(1)
  })
})
