import { describe, expect, test } from 'bun:test'

import {
  canGoBackFrom,
  directionOfKey,
  intentOfKey,
  type KeyInput,
  keyOfDirection,
  type KeyTarget,
} from './keys.ts'

const key = (name: string, extra: Partial<KeyInput> = {}): KeyInput => ({
  key: name,
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  defaultPrevented: false,
  ...extra,
})

const page: KeyTarget = { editing: false, arrowWidget: false, nativeEnter: false, layerOpen: false }

describe('intentOfKey', () => {
  test('arrows move, Enter activates, Escape and the back keys go back', () => {
    expect(intentOfKey(key('ArrowDown'), page)).toEqual({ kind: 'move', direction: 'down' })
    expect(intentOfKey(key('ArrowLeft'), page)).toEqual({ kind: 'move', direction: 'left' })
    expect(intentOfKey(key('Enter'), page)).toEqual({ kind: 'activate' })
    for (const name of ['Escape', 'Backspace', 'BrowserBack', 'GoBack'])
      expect(intentOfKey(key(name), page)).toEqual({ kind: 'back' })
    expect(intentOfKey(key('a'), page)).toBeUndefined()
  })

  test('never takes a key already handled, with a modifier, or typed into a field', () => {
    expect(intentOfKey(key('ArrowDown', { defaultPrevented: true }), page)).toBeUndefined()
    expect(intentOfKey(key('ArrowDown', { shiftKey: true }), page)).toBeUndefined()
    expect(intentOfKey(key('ArrowDown', { altKey: true }), page)).toBeUndefined()
    expect(intentOfKey(key('Backspace', { ctrlKey: true }), page)).toBeUndefined()
    const field = { ...page, editing: true }
    for (const name of ['ArrowDown', 'Enter', 'Escape', 'Backspace'])
      expect(intentOfKey(key(name), field)).toBeUndefined()
  })

  test('Backspace is no way back inside a form or a dialog; Escape and the back keys are', () => {
    const form = { ...page, inForm: true }
    expect(intentOfKey(key('Backspace'), form)).toBeUndefined()
    expect(intentOfKey(key('Escape'), form)).toEqual({ kind: 'back' })
    expect(intentOfKey(key('BrowserBack'), form)).toEqual({ kind: 'back' })
  })

  test('the back keys are never typed: back even from a text field', () => {
    const field = { ...page, editing: true, lineField: true }
    expect(intentOfKey(key('BrowserBack'), field)).toEqual({ kind: 'back' })
    expect(intentOfKey(key('GoBack'), field)).toEqual({ kind: 'back' })
    expect(intentOfKey(key('Backspace'), field)).toBeUndefined()
  })

  test('directionOfKey and keyOfDirection are inverse', () => {
    for (const direction of ['up', 'down', 'left', 'right'] as const)
      expect(directionOfKey(keyOfDirection[direction])).toBe(direction)
    expect(directionOfKey('Enter')).toBeUndefined()
  })

  test('a single-line text field keeps its keys but ↑/↓, which leave it', () => {
    const field = { ...page, editing: true, lineField: true }
    expect(intentOfKey(key('ArrowDown'), field)).toEqual({ kind: 'move', direction: 'down' })
    expect(intentOfKey(key('ArrowUp'), field)).toEqual({ kind: 'move', direction: 'up' })
    for (const name of ['ArrowLeft', 'ArrowRight', 'Enter', 'Escape', 'Backspace'])
      expect(intentOfKey(key(name), field)).toBeUndefined()
    // A combobox's list takes ↑/↓ first.
    expect(intentOfKey(key('ArrowDown', { defaultPrevented: true }), field)).toBeUndefined()
  })

  test('a widget keeps its arrows, a button its Enter, an open layer its Escape', () => {
    const listbox = { ...page, arrowWidget: true }
    expect(intentOfKey(key('ArrowDown'), listbox)).toBeUndefined()
    expect(intentOfKey(key('Backspace'), listbox)).toEqual({ kind: 'back' })
    // A slider or a radio input keeps ←/→; ↑/↓ leave it (no trap for a remote).
    const slider = { ...page, rowWidget: true }
    expect(intentOfKey(key('ArrowRight'), slider)).toBeUndefined()
    expect(intentOfKey(key('ArrowDown'), slider)).toEqual({ kind: 'move', direction: 'down' })
    expect(intentOfKey(key('Enter'), { ...page, nativeEnter: true })).toBeUndefined()
    const layer = { ...page, layerOpen: true }
    expect(intentOfKey(key('Escape'), layer)).toBeUndefined()
    // Backspace closes the layer through the back intent.
    expect(intentOfKey(key('Backspace'), layer)).toEqual({ kind: 'back' })
  })
})

test('canGoBackFrom: never from the root, only to an entry of the app', () => {
  expect(canGoBackFrom('/', true)).toBe(false)
  expect(canGoBackFrom('/items/1', false)).toBe(false)
  expect(canGoBackFrom('/items/1', true)).toBe(true)
})
