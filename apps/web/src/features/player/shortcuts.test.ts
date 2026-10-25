import { describe, expect, test } from 'bun:test'

import {
  commandFor,
  isDoubleTap,
  isVerticalDrag,
  type KeyContext,
  tapZone,
  volumeAfterDrag,
} from './shortcuts.ts'

const key = (value: string, modifiers: Partial<{ ctrlKey: boolean; metaKey: boolean }> = {}) => ({
  key: value,
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  ...modifiers,
})

const idle: KeyContext = { editing: false, inOverlay: false, overlayOpen: false, fullscreen: false }

describe('commandFor', () => {
  test('the shortcuts of §10.7', () => {
    expect(commandFor(key(' '), idle)).toBe('toggle_play')
    expect(commandFor(key('ArrowLeft'), idle)).toBe('seek_back')
    expect(commandFor(key('ArrowRight'), idle)).toBe('seek_forward')
    expect(commandFor(key('ArrowUp'), idle)).toBe('volume_up')
    expect(commandFor(key('ArrowDown'), idle)).toBe('volume_down')
    expect(commandFor(key('M'), idle)).toBe('toggle_mute')
    expect(commandFor(key('f'), idle)).toBe('toggle_fullscreen')
    expect(commandFor(key('s'), idle)).toBe('skip_segment')
    expect(commandFor(key('N'), idle)).toBe('next_episode')
    expect(commandFor(key('c'), idle)).toBe('toggle_subtitles')
    expect(commandFor(key('Escape'), idle)).toBe('exit')
    expect(commandFor(key('x'), idle)).toBeUndefined()
  })

  test('modifiers and text fields belong to the browser', () => {
    expect(commandFor(key('f', { metaKey: true }), idle)).toBeUndefined()
    expect(commandFor(key('c', { ctrlKey: true }), idle)).toBeUndefined()
    expect(commandFor(key(' '), { ...idle, editing: true })).toBeUndefined()
  })

  test('Escape closes an open menu first, and is left to the browser in fullscreen', () => {
    expect(commandFor(key('Escape'), { ...idle, overlayOpen: true })).toBe('close_overlay')
    expect(commandFor(key('Escape'), { ...idle, fullscreen: true })).toBeUndefined()
  })

  test('inside the menu only Escape is the player’s', () => {
    const inMenu = { ...idle, inOverlay: true, overlayOpen: true }
    expect(commandFor(key(' '), inMenu)).toBeUndefined()
    expect(commandFor(key('ArrowDown'), inMenu)).toBeUndefined()
    expect(commandFor(key('Escape'), inMenu)).toBe('close_overlay')
  })
})

describe('gestures', () => {
  test('thirds of the screen', () => {
    expect(tapZone(10, 390)).toBe('left')
    expect(tapZone(195, 390)).toBe('center')
    expect(tapZone(380, 390)).toBe('right')
    expect(tapZone(10, 0)).toBe('center')
  })

  test('a double tap is quick and close', () => {
    const first = { time: 1000, x: 50, y: 300 }
    expect(isDoubleTap(undefined, first)).toBe(false)
    expect(isDoubleTap(first, { time: 1250, x: 60, y: 310 })).toBe(true)
    expect(isDoubleTap(first, { time: 1400, x: 60, y: 310 })).toBe(false)
    expect(isDoubleTap(first, { time: 1100, x: 300, y: 300 })).toBe(false)
  })

  test('vertical drags set the volume', () => {
    expect(isVerticalDrag(2, 30)).toBe(true)
    expect(isVerticalDrag(30, 30)).toBe(false)
    expect(isVerticalDrag(0, 5)).toBe(false)
    expect(volumeAfterDrag(0.5, -300, 1000)).toBe(1)
    expect(volumeAfterDrag(0.5, 150, 1000)).toBeCloseTo(0.25)
    expect(volumeAfterDrag(0.2, 900, 1000)).toBe(0)
  })
})
