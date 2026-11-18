import { describe, expect, test } from 'bun:test'

import {
  commandFor,
  focusedControlOf,
  isVerticalDrag,
  type KeyContext,
  liveCommandFor,
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
    expect(commandFor(key('I'), idle)).toBe('toggle_info')
    expect(commandFor(key('Escape'), idle)).toBe('exit')
    expect(commandFor(key('x'), idle)).toBeUndefined()
  })

  test('< and > step the speed, whatever the layout puts them under', () => {
    expect(commandFor(key('<'), idle)).toBe('speed_down')
    expect(commandFor(key('>'), idle)).toBe('speed_up')
    expect(commandFor(key('>', { ctrlKey: true }), idle)).toBeUndefined()
    expect(commandFor(key('<'), { ...idle, inOverlay: true, overlayOpen: true })).toBeUndefined()
    expect(commandFor(key('>'), { ...idle, editing: true })).toBeUndefined()
  })

  test('modifiers and text fields belong to the browser', () => {
    expect(commandFor(key('f', { metaKey: true }), idle)).toBeUndefined()
    expect(commandFor(key('c', { ctrlKey: true }), idle)).toBeUndefined()
    expect(commandFor(key(' '), { ...idle, editing: true })).toBeUndefined()
  })

  test('Escape closes an open menu first, and is left to the browser in fullscreen', () => {
    expect(commandFor(key('Escape'), { ...idle, overlayOpen: true })).toBe('close_overlay')
    expect(commandFor(key('Escape'), { ...idle, fullscreen: true })).toBeUndefined()
    // The desktop window's full screen: the page leaves it (§28.4).
    expect(commandFor(key('Escape'), { ...idle, fullscreen: true, ownFullscreen: true })).toBe(
      'toggle_fullscreen',
    )
  })

  test('with no control focused, Enter shows the chrome, or takes the prompt on screen', () => {
    expect(commandFor(key('Enter'), idle)).toBe('focus_controls')
    expect(commandFor(key('Enter'), { ...idle, promptShown: true })).toBe('activate_prompt')
    const onButton = { ...idle, focusedControl: 'activatable' as const, promptShown: true }
    expect(commandFor(key('Enter'), onButton)).toBeUndefined()
  })

  test('Backspace and the back keys act as Escape, and also leave the browser’s full screen', () => {
    for (const name of ['Backspace', 'BrowserBack', 'GoBack']) {
      expect(commandFor(key(name), idle)).toBe('exit')
      expect(commandFor(key(name), { ...idle, overlayOpen: true })).toBe('close_overlay')
      expect(commandFor(key(name), { ...idle, fullscreen: true })).toBe('toggle_fullscreen')
    }
    expect(commandFor(key('Backspace'), { ...idle, editing: true })).toBeUndefined()
  })

  test('inside the menu only Escape is the player’s', () => {
    const inMenu = { ...idle, inOverlay: true, overlayOpen: true }
    expect(commandFor(key(' '), inMenu)).toBeUndefined()
    expect(commandFor(key('ArrowDown'), inMenu)).toBeUndefined()
    expect(commandFor(key('Escape'), inMenu)).toBe('close_overlay')
  })
})

describe('a control with keyboard focus', () => {
  test('Space and Enter activate it instead of play/pause; arrows move focus', () => {
    const onButton = { ...idle, focusedControl: 'activatable' as const }
    expect(commandFor(key(' '), onButton)).toBeUndefined()
    expect(commandFor(key('Enter'), onButton)).toBeUndefined()
    expect(commandFor(key('ArrowRight'), onButton)).toBe('focus_right')
    expect(commandFor(key('ArrowUp'), onButton)).toBe('focus_up')
    expect(commandFor(key('m'), onButton)).toBe('toggle_mute')
  })

  test('the timeline keeps ←/→ to seek, ↑/↓ leave it', () => {
    const onTimeline = { ...idle, focusedControl: 'slider' as const }
    expect(commandFor(key('ArrowLeft'), onTimeline)).toBe('seek_back')
    expect(commandFor(key('ArrowRight'), onTimeline)).toBe('seek_forward')
    expect(commandFor(key('ArrowDown'), onTimeline)).toBe('focus_down')
    expect(commandFor(key('ArrowUp'), onTimeline)).toBe('focus_up')
    expect(commandFor(key(' '), onTimeline)).toBe('toggle_play')
  })

  test('Escape: the menu, then keyboard focus, then the full screen, then the player', () => {
    const onButton = { ...idle, focusedControl: 'activatable' as const }
    expect(commandFor(key('Escape'), { ...onButton, overlayOpen: true })).toBe('close_overlay')
    expect(commandFor(key('Escape'), onButton)).toBe('release_focus')
    expect(commandFor(key('Escape'), { ...idle, fullscreen: true, ownFullscreen: true })).toBe(
      'toggle_fullscreen',
    )
    expect(commandFor(key('Escape'), idle)).toBe('exit')
  })

  test('the volume slider keeps its arrow keys, Space still plays', () => {
    const onRange = { ...idle, focusedControl: 'range' as const }
    expect(commandFor(key('ArrowLeft'), onRange)).toBeUndefined()
    expect(commandFor(key('ArrowUp'), onRange)).toBeUndefined()
    expect(commandFor(key('End'), onRange)).toBeUndefined()
    expect(commandFor(key(' '), onRange)).toBe('toggle_play')
  })

  test('what the focused element is', () => {
    const keyboard = { keyboardFocused: true }
    expect(focusedControlOf({ ...keyboard, tagName: 'BUTTON' })).toBe('activatable')
    expect(focusedControlOf({ ...keyboard, tagName: 'BUTTON', role: 'radio' })).toBe('activatable')
    expect(focusedControlOf({ ...keyboard, tagName: 'A' })).toBe('activatable')
    expect(focusedControlOf({ ...keyboard, tagName: 'INPUT', type: 'range' })).toBe('range')
    expect(focusedControlOf({ ...keyboard, tagName: 'INPUT', type: 'checkbox' })).toBe(
      'activatable',
    )
    // The page itself is no control.
    expect(focusedControlOf({ ...keyboard, tagName: 'DIV', role: 'slider' })).toBe('slider')
    expect(focusedControlOf({ ...keyboard, tagName: 'BODY' })).toBeUndefined()
  })

  test('a button clicked with the mouse is not keyboard focused: Space plays and pauses', () => {
    const control = focusedControlOf({ tagName: 'BUTTON', keyboardFocused: false })
    expect(control).toBeUndefined()
    expect(commandFor(key(' '), { ...idle, focusedControl: control })).toBe('toggle_play')
  })
})

describe('liveCommandFor (§29.5)', () => {
  test('channels and playback, no seeking', () => {
    expect(liveCommandFor(key(' '), idle)).toBe('toggle_play')
    expect(liveCommandFor(key('K'), idle)).toBe('toggle_play')
    expect(liveCommandFor(key('PageUp'), idle)).toBe('previous_channel')
    expect(liveCommandFor(key('PageDown'), idle)).toBe('next_channel')
    expect(liveCommandFor(key('l'), idle)).toBe('toggle_channels')
    expect(liveCommandFor(key('ArrowUp'), idle)).toBe('volume_up')
    expect(liveCommandFor(key('m'), idle)).toBe('toggle_mute')
    expect(liveCommandFor(key('f'), idle)).toBe('toggle_fullscreen')
    expect(liveCommandFor(key('ArrowLeft'), idle)).toBeUndefined()
    expect(liveCommandFor(key('s'), idle)).toBeUndefined()
    expect(liveCommandFor(key('<'), idle)).toBeUndefined()
  })

  test('Escape closes the channel list first, and the list keeps its own keys', () => {
    expect(liveCommandFor(key('Escape'), { ...idle, overlayOpen: true })).toBe('close_overlay')
    expect(liveCommandFor(key('PageDown'), { ...idle, inOverlay: true })).toBeUndefined()
    expect(liveCommandFor(key('ArrowRight'), { ...idle, focusedControl: 'activatable' })).toBe(
      'focus_right',
    )
  })
})

describe('gestures', () => {
  test('thirds of the screen', () => {
    expect(tapZone(10, 390)).toBe('left')
    expect(tapZone(195, 390)).toBe('center')
    expect(tapZone(380, 390)).toBe('right')
    expect(tapZone(10, 0)).toBe('center')
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
