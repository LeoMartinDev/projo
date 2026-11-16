import { type Direction, isHorizontal } from './geometry.ts'

// The intents a remote, a keyboard or a gamepad sends (§19): move in a
// direction, activate what has focus, go back; a gamepad also opens the focused
// card's menu and drives playback (the player takes that, the page ignores
// it). The keyboard adapter maps keys to them, never taking a key from what
// already handles it.

export type MediaAction = 'toggle_play' | 'seek_back' | 'seek_forward'

export type NavIntent =
  | { kind: 'move'; direction: Direction }
  | { kind: 'activate' }
  | { kind: 'back' }
  | { kind: 'menu' }
  | { kind: 'media'; action: MediaAction }

export type KeyInput = {
  key: string
  altKey: boolean
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
  defaultPrevented: boolean
}

/** What the key lands on, as far as the intents care. */
export type KeyTarget = {
  // A text field, a text area, an editable region or a native select: it keeps every key,
  editing: boolean
  // except a single-line text field, whose ↑/↓ leave it (they only move its caret to an end).
  lineField?: boolean
  // A widget that moves with the arrows by itself (listbox, spin button, grid…).
  arrowWidget: boolean
  // A widget that keeps ←/→ (a range or a slider, a radio input): ↑/↓ leave it.
  rowWidget?: boolean
  // An element Enter activates natively (button, link, summary, submit input).
  nativeEnter: boolean
  // A modal dialog or a popover is open: Escape closes it natively.
  layerOpen: boolean
  // Inside a form or a dialog: Backspace is no way back there (edits would be lost).
  inForm?: boolean
}

export const keyOfDirection: Record<Direction, string> = {
  up: 'ArrowUp',
  down: 'ArrowDown',
  left: 'ArrowLeft',
  right: 'ArrowRight',
}

export const allDirections: readonly Direction[] = ['up', 'down', 'left', 'right']

/** The direction of an arrow key. */
export const directionOfKey = (key: string): Direction | undefined =>
  allDirections.find((direction) => keyOfDirection[direction] === key)

// `BrowserBack` (Windows' back key, remotes) and `GoBack` (some TV remotes):
// never typed, and the browser goes back on them by itself unless the page takes them.
export const browserBackKeys = ['BrowserBack', 'GoBack']
export const backKeys = ['Backspace', ...browserBackKeys]

export const intentOfKey = (input: KeyInput, target: KeyTarget): NavIntent | undefined => {
  if (input.defaultPrevented || input.altKey || input.ctrlKey || input.metaKey) return undefined
  if (input.shiftKey) return undefined
  if (browserBackKeys.includes(input.key)) return { kind: 'back' }
  const direction = directionOfKey(input.key)
  if (target.editing)
    return target.lineField === true && (direction === 'up' || direction === 'down')
      ? { kind: 'move', direction }
      : undefined
  if (direction !== undefined)
    return target.arrowWidget || (target.rowWidget === true && isHorizontal(direction))
      ? undefined
      : { kind: 'move', direction }
  if (input.key === 'Enter') return target.nativeEnter ? undefined : { kind: 'activate' }
  if (input.key === 'Escape') return target.layerOpen ? undefined : { kind: 'back' }
  if (input.key === 'Backspace' && target.inForm !== true) return { kind: 'back' }
  return undefined
}

/** Whether to go back from `pathname`: never from the app's root, only to an entry of the app. */
export const canGoBackFrom = (pathname: string, hasAppEntry: boolean) =>
  pathname !== '/' && hasAppEntry
