/**
 * Keyboard shortcuts of the player (§10.7) and touch gestures (double tap ±10 s, vertical drag
 * for the volume). Pure: the page maps commands to actions.
 */

export type PlayerCommand =
  | 'toggle_play'
  | 'seek_back'
  | 'seek_forward'
  | 'volume_up'
  | 'volume_down'
  | 'toggle_mute'
  | 'toggle_fullscreen'
  | 'skip_segment'
  | 'next_episode'
  | 'toggle_subtitles'
  | 'close_overlay'
  | 'exit'

export type KeyInput = {
  key: string
  altKey: boolean
  ctrlKey: boolean
  metaKey: boolean
}

export type KeyContext = {
  /** Focus is in a text field (none in the player today, but a menu may get one). */
  editing: boolean
  /** Focus is inside the menu or the episodes panel: they handle their own keys. */
  inOverlay: boolean
  /** The menu or the episodes panel is open: Escape closes it first. */
  overlayOpen: boolean
  /** The browser is fullscreen: it handles Escape itself. */
  fullscreen: boolean
}

const letters: Record<string, PlayerCommand> = {
  k: 'toggle_play',
  m: 'toggle_mute',
  f: 'toggle_fullscreen',
  s: 'skip_segment',
  n: 'next_episode',
  c: 'toggle_subtitles',
}

const keys: Record<string, PlayerCommand> = {
  ' ': 'toggle_play',
  ArrowLeft: 'seek_back',
  ArrowRight: 'seek_forward',
  ArrowUp: 'volume_up',
  ArrowDown: 'volume_down',
}

export const commandFor = (input: KeyInput, context: KeyContext): PlayerCommand | undefined => {
  if (input.altKey || input.ctrlKey || input.metaKey || context.editing) return undefined
  if (input.key === 'Escape') {
    if (context.overlayOpen) return 'close_overlay'
    return context.fullscreen ? undefined : 'exit'
  }
  if (context.inOverlay) return undefined
  return keys[input.key] ?? letters[input.key.toLowerCase()]
}

// ── Touch gestures ───────────────────────────────────────────────────────────

export type TapZone = 'left' | 'center' | 'right'

/** Left and right thirds seek, the middle one toggles the chrome. */
export const tapZone = (x: number, width: number): TapZone =>
  width <= 0 ? 'center' : x < width / 3 ? 'left' : x > (width * 2) / 3 ? 'right' : 'center'

export type Tap = { time: number; x: number; y: number }

export const doubleTapMs = 300
const doubleTapDistance = 60

export const isDoubleTap = (previous: Tap | undefined, current: Tap) =>
  previous !== undefined &&
  current.time - previous.time <= doubleTapMs &&
  Math.hypot(current.x - previous.x, current.y - previous.y) <= doubleTapDistance

/** A drag is a volume gesture once clearly vertical. */
export const isVerticalDrag = (dx: number, dy: number) =>
  Math.abs(dy) >= 14 && Math.abs(dy) > Math.abs(dx) * 1.5

/** Dragging up by 60 % of the height goes from silence to full volume. */
export const volumeAfterDrag = (startVolume: number, dy: number, height: number) =>
  height <= 0 ? startVolume : Math.min(1, Math.max(0, startVolume - dy / (height * 0.6)))
