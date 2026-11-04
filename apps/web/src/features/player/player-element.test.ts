import { describe, expect, test } from 'bun:test'

import { isPlainClick, isWatchHref, opensInFullscreen } from './player-element.ts'

const click = {
  button: 0,
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  defaultPrevented: false,
}

describe('priming the player from the gesture that opens it', () => {
  test('only a plain primary click opens the player in this tab', () => {
    expect(isPlainClick(click)).toBe(true)
    expect(isPlainClick({ ...click, button: 1 })).toBe(false)
    expect(isPlainClick({ ...click, metaKey: true })).toBe(false)
    expect(isPlainClick({ ...click, ctrlKey: true })).toBe(false)
    expect(isPlainClick({ ...click, shiftKey: true })).toBe(false)
    expect(isPlainClick({ ...click, defaultPrevented: true })).toBe(false)
  })

  test('a link to /watch/ on this origin is a player link', () => {
    const origin = 'https://projo.local'
    expect(isWatchHref('https://projo.local/watch/abc', origin)).toBe(true)
    expect(isWatchHref('/watch/abc?from=start', origin)).toBe(true)
    expect(isWatchHref('/items/abc', origin)).toBe(false)
    expect(isWatchHref('https://elsewhere.test/watch/abc', origin)).toBe(false)
  })

  test('a touch device enters fullscreen when it can and is not there yet', () => {
    expect(opensInFullscreen({ touch: true, active: false, available: true })).toBe(true)
    expect(opensInFullscreen({ touch: false, active: false, available: true })).toBe(false)
    expect(opensInFullscreen({ touch: true, active: true, available: true })).toBe(false)
    expect(opensInFullscreen({ touch: true, active: false, available: false })).toBe(false)
  })
})
