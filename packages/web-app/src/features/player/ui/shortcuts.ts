import { backKeys } from '../../../shared/ui/spatial-nav/keys.ts'

// What both players do with Escape, Enter and the arrows over their controls.
type ChromeCommand =
  | 'toggle_fullscreen'
  | 'close_overlay'
  | 'exit'
  // Couch navigation (§10.7, §19): focus between the controls, the chrome's
  // first control, the "Skip intro" or "Next episode" prompt, focus let go.
  | 'focus_up'
  | 'focus_down'
  | 'focus_left'
  | 'focus_right'
  | 'focus_controls'
  | 'activate_prompt'
  | 'release_focus'

export type PlayerCommand =
  | ChromeCommand
  | 'toggle_play'
  | 'seek_back'
  | 'seek_forward'
  | 'volume_up'
  | 'volume_down'
  | 'toggle_mute'
  | 'skip_segment'
  | 'next_episode'
  | 'toggle_subtitles'
  | 'toggle_info'
  | 'speed_down'
  | 'speed_up'

// The live player's (§29.5): no speed, tracks nor prompts; channels instead, and ±10 s in the
// replay window with timeshift.
export type LiveCommand =
  | ChromeCommand
  | 'toggle_play'
  | 'seek_back'
  | 'seek_forward'
  | 'volume_up'
  | 'volume_down'
  | 'toggle_mute'
  | 'previous_channel'
  | 'next_channel'
  | 'toggle_channels'

export type KeyInput = {
  key: string
  altKey: boolean
  ctrlKey: boolean
  metaKey: boolean
}

// A control of the player that has keyboard focus (`:focus-visible`): a
// button, link, radio or switch is activated by Space and Enter; a range input
// (the volume) keeps its own arrow keys; the timeline (a slider) keeps ←/→ to
// seek (§10.7).
export type FocusedControl = 'activatable' | 'range' | 'slider'

export type KeyContext = {
  editing: boolean
  inOverlay: boolean
  overlayOpen: boolean
  fullscreen: boolean
  // The page leaves its full screen itself on Escape (the desktop window's,
  // §28.4); otherwise the browser does.
  ownFullscreen?: boolean
  focusedControl?: FocusedControl | undefined
  // "Skip intro" or a "Next episode" prompt is on screen: Enter takes it.
  promptShown?: boolean
}

const activatableRoles = ['button', 'link', 'radio', 'switch', 'checkbox', 'tab', 'menuitem']
const activatableInputs = ['button', 'checkbox', 'radio', 'submit', 'reset']

/** What the focused element is to the player's keys; undefined when focused by a pointer. */
export const focusedControlOf = (element: {
  tagName: string
  type?: string | undefined
  role?: string | undefined
  keyboardFocused: boolean
}): FocusedControl | undefined => {
  if (!element.keyboardFocused) return undefined
  const tag = element.tagName.toLowerCase()
  if (tag === 'input')
    return element.type === 'range'
      ? 'range'
      : activatableInputs.includes(element.type ?? '')
        ? 'activatable'
        : undefined
  if (element.role === 'slider') return 'slider'
  if (element.role !== undefined && element.role !== '')
    return activatableRoles.includes(element.role) ? 'activatable' : undefined
  return tag === 'button' || tag === 'a' ? 'activatable' : undefined
}

type Bindings<C extends string> = { keys: Record<string, C>; letters: Record<string, C> }

const letters: Record<string, PlayerCommand> = {
  k: 'toggle_play',
  m: 'toggle_mute',
  f: 'toggle_fullscreen',
  s: 'skip_segment',
  n: 'next_episode',
  c: 'toggle_subtitles',
  i: 'toggle_info',
}

const rangeKeys = [
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
  'Home',
  'End',
  'PageUp',
  'PageDown',
]

const keys: Record<string, PlayerCommand> = {
  ' ': 'toggle_play',
  ArrowLeft: 'seek_back',
  ArrowRight: 'seek_forward',
  ArrowUp: 'volume_up',
  ArrowDown: 'volume_down',
  // Shift is not a modifier here: `>` needs it on most layouts.
  '<': 'speed_down',
  '>': 'speed_up',
}

const playerBindings: Bindings<PlayerCommand> = { keys, letters }

const liveBindings: Bindings<LiveCommand> = {
  keys: {
    ' ': 'toggle_play',
    ArrowUp: 'volume_up',
    ArrowDown: 'volume_down',
    PageUp: 'previous_channel',
    PageDown: 'next_channel',
  },
  letters: { k: 'toggle_play', m: 'toggle_mute', f: 'toggle_fullscreen', l: 'toggle_channels' },
}

// With timeshift (§29.5), ←/→ seek like a title's.
const liveTimeshiftBindings: Bindings<LiveCommand> = {
  ...liveBindings,
  keys: { ...liveBindings.keys, ArrowLeft: 'seek_back', ArrowRight: 'seek_forward' },
}

const focusMoves: Record<string, ChromeCommand> = {
  ArrowUp: 'focus_up',
  ArrowDown: 'focus_down',
  ArrowLeft: 'focus_left',
  ArrowRight: 'focus_right',
}

const escapeCommand = (context: KeyContext, back: boolean): ChromeCommand | undefined => {
  if (context.overlayOpen) return 'close_overlay'
  if (context.focusedControl !== undefined) return 'release_focus'
  if (!context.fullscreen) return 'exit'
  // Escape leaves the browser's full screen by itself, a back key does not.
  return context.ownFullscreen === true || back ? 'toggle_fullscreen' : undefined
}

const resolveKey = <C extends string>(
  input: KeyInput,
  context: KeyContext,
  bindings: Bindings<C>,
): C | ChromeCommand | undefined => {
  if (input.altKey || input.ctrlKey || input.metaKey || context.editing) return undefined
  // Backspace and the back keys of keyboards and remotes act as Escape (§10.7).
  const back = backKeys.includes(input.key)
  if (input.key === 'Escape' || back) return escapeCommand(context, back)
  if (context.inOverlay) return undefined
  const control = context.focusedControl
  if (input.key === 'Enter') {
    if (control !== undefined) return undefined
    return context.promptShown === true ? 'activate_prompt' : 'focus_controls'
  }
  if (control === 'activatable' && input.key === ' ') return undefined
  if (control === 'range' && rangeKeys.includes(input.key)) return undefined
  const move = focusMoves[input.key]
  if (move !== undefined && control !== undefined) {
    // The timeline keeps ←/→ to seek; ↑/↓ leave it.
    if (control !== 'slider' || move === 'focus_up' || move === 'focus_down') return move
  }
  return bindings.keys[input.key] ?? bindings.letters[input.key.toLowerCase()]
}

export const commandFor = (input: KeyInput, context: KeyContext): PlayerCommand | undefined =>
  resolveKey(input, context, playerBindings)

/**
 * The live player's keys (§29.5): with timeshift, `←`/`→` seek 10 s (focus moves on a focused
 * control, as §10.7); without, they only move focus between controls.
 */
export const liveCommandFor = (
  input: KeyInput,
  context: KeyContext & { timeshift?: boolean },
): LiveCommand | undefined =>
  resolveKey(input, context, context.timeshift === true ? liveTimeshiftBindings : liveBindings)

export type TapZone = 'left' | 'center' | 'right'

export const tapZone = (x: number, width: number): TapZone =>
  width <= 0 ? 'center' : x < width / 3 ? 'left' : x > (width * 2) / 3 ? 'right' : 'center'

export const isVerticalDrag = (dx: number, dy: number) =>
  Math.abs(dy) >= 14 && Math.abs(dy) > Math.abs(dx) * 1.5

export const volumeAfterDrag = (startVolume: number, dy: number, height: number) =>
  height <= 0 ? startVolume : Math.min(1, Math.max(0, startVolume - dy / (height * 0.6)))
