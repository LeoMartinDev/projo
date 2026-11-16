import type { Direction } from '../spatial-nav/geometry.ts'
import { allDirections, type MediaAction, type NavIntent } from '../spatial-nav/keys.ts'

// A gamepad on the intent layer (§19), the pure part: from what the pads held
// on the last frame and what they hold now, the intents to send. A button
// sends its intent once when pressed; a direction (d-pad, left stick) sends a
// move at once, then repeats while held. Several pads act as one.
//
// The W3C "standard" mapping (an Xbox pad): d-pad (12–15) and left stick move,
// A (0) activates, B (1) and View (8) go back, X (2) and Start (9) play or
// pause, LB/RB (4/5) seek −10 s/+10 s, Y (3) opens the focused card's menu.
// Another mapping numbers its buttons its own way: only the left stick, button
// 0 (activate) and 1 (back), the ones every pad puts there.

/** One connected pad, as read on a frame. */
export type PadSnapshot = {
  index: number
  // The W3C "standard" mapping.
  standard: boolean
  pressed: readonly boolean[]
  axes: readonly number[]
}

type Control = Direction | 'activate' | 'back' | 'menu' | MediaAction

export type PadState = {
  // What the pads held on the last frame, all together.
  held: readonly Control[]
  // The direction each pad's left stick points to (by pad index).
  sticks: ReadonlyMap<number, Direction>
  // The direction that repeats while held: the last one pressed, and when.
  repeat?: { direction: Direction; at: number }
}

export const initialPadState: PadState = { held: [], sticks: new Map() }

export const repeatDelayMs = 400
export const repeatIntervalMs = 120

// The stick points somewhere past `stickPress` and stops below `stickRelease`;
// another direction takes over only when it leads by `stickSwitch`, so a
// diagonal does not flicker between two.
export const stickPress = 0.5
export const stickRelease = 0.35
const stickSwitch = 0.2

const standardButtons: readonly (readonly [number, Control])[] = [
  [12, 'up'],
  [13, 'down'],
  [14, 'left'],
  [15, 'right'],
  [0, 'activate'],
  [1, 'back'],
  [8, 'back'],
  [2, 'toggle_play'],
  [9, 'toggle_play'],
  [4, 'seek_back'],
  [5, 'seek_forward'],
  [3, 'menu'],
]

const otherButtons: readonly (readonly [number, Control])[] = [
  [0, 'activate'],
  [1, 'back'],
]

const isDirection = (control: Control): control is Direction =>
  (allDirections as readonly string[]).includes(control)

const mediaActions: readonly MediaAction[] = ['toggle_play', 'seek_back', 'seek_forward']

const isMedia = (control: Control): control is MediaAction =>
  (mediaActions as readonly string[]).includes(control)

const intentOf = (control: Control): NavIntent =>
  isDirection(control)
    ? { kind: 'move', direction: control }
    : isMedia(control)
      ? { kind: 'media', action: control }
      : { kind: control }

const axis = (value: number | undefined) =>
  value === undefined || !Number.isFinite(value) ? 0 : value

// How far the stick leans toward `direction` (negative when away from it).
const toward = (direction: Direction, x: number, y: number) =>
  direction === 'right' ? x : direction === 'left' ? -x : direction === 'down' ? y : -y

/** Where a stick points, from where it pointed: a dead zone with hysteresis, the dominant axis. */
export const stickDirection = (
  current: Direction | undefined,
  x: number,
  y: number,
): Direction | undefined => {
  const across = Math.abs(x) >= Math.abs(y)
  const dominant: Direction = across ? (x > 0 ? 'right' : 'left') : y > 0 ? 'down' : 'up'
  const strength = Math.max(Math.abs(x), Math.abs(y))
  const kept = current === undefined ? 0 : toward(current, x, y)
  if (current !== undefined && kept >= stickRelease)
    return dominant !== current && strength >= stickPress && strength - kept >= stickSwitch
      ? dominant
      : current
  return strength >= stickPress ? dominant : undefined
}

/** The pads' new state and the intents to send, in the order pressed. */
export const readPads = (
  state: PadState,
  pads: readonly PadSnapshot[],
  now: number,
): { state: PadState; intents: readonly NavIntent[] } => {
  const sticks = new Map<number, Direction>()
  for (const pad of pads) {
    const direction = stickDirection(
      state.sticks.get(pad.index),
      axis(pad.axes[0]),
      axis(pad.axes[1]),
    )
    if (direction !== undefined) sticks.set(pad.index, direction)
  }
  const buttons = pads.flatMap((pad) =>
    (pad.standard ? standardButtons : otherButtons)
      .filter(([button]) => pad.pressed[button] === true)
      .map(([, control]) => control),
  )
  const held = [...new Set([...buttons, ...sticks.values()])]
  const pressed = held.filter((control) => !state.held.includes(control))
  const intents = pressed.map(intentOf)

  const newest = pressed.filter(isDirection).at(-1)
  const previous = state.repeat
  const repeat =
    newest !== undefined
      ? { direction: newest, at: now + repeatDelayMs }
      : previous !== undefined && held.includes(previous.direction)
        ? now >= previous.at
          ? { direction: previous.direction, at: now + repeatIntervalMs }
          : previous
        : undefined
  if (newest === undefined && repeat !== undefined && repeat !== previous)
    intents.push(intentOf(repeat.direction))

  return {
    state: { held, sticks, ...(repeat === undefined ? {} : { repeat }) },
    intents,
  }
}

/**
 * The state when reading resumes after a pause (the page hidden, the window
 * unfocused): what was held stays held (no press on return), and a direction
 * still held waits the full delay again before it repeats.
 */
export const resumePads = (state: PadState, now: number): PadState => {
  const { repeat, ...rest } = state
  return repeat === undefined
    ? rest
    : { ...rest, repeat: { direction: repeat.direction, at: now + repeatDelayMs } }
}
