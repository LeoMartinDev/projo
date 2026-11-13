import { describe, expect, test } from 'bun:test'

import { createFullscreenScope, fullscreenAction } from './fullscreen.ts'

describe('fullscreen across episodes (§10.7)', () => {
  test('the document goes fullscreen where it can, the video only on iOS Safari', () => {
    const can = { documentFullscreen: true, mediaFullscreen: true }
    expect(fullscreenAction({ active: false, ...can })).toBe('document')
    expect(fullscreenAction({ active: true, ...can })).toBe('exit')
    expect(
      fullscreenAction({ active: false, documentFullscreen: false, mediaFullscreen: true }),
    ).toBe('media')
    expect(
      fullscreenAction({ active: false, documentFullscreen: false, mediaFullscreen: false }),
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
    leaveFirst()
    const leaveSecond = scope.enter()
    tick()
    expect(exits).toBe(0)
    leaveSecond()
    tick()
    expect(exits).toBe(1)
  })
})
