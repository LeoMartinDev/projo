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
  editing: boolean
  inOverlay: boolean
  overlayOpen: boolean
  fullscreen: boolean
  // The page leaves its full screen itself on Escape (the desktop window's,
  // §28.4); otherwise the browser does.
  ownFullscreen?: boolean
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
    if (!context.fullscreen) return 'exit'
    return context.ownFullscreen === true ? 'toggle_fullscreen' : undefined
  }
  if (context.inOverlay) return undefined
  return keys[input.key] ?? letters[input.key.toLowerCase()]
}

export type TapZone = 'left' | 'center' | 'right'

export const tapZone = (x: number, width: number): TapZone =>
  width <= 0 ? 'center' : x < width / 3 ? 'left' : x > (width * 2) / 3 ? 'right' : 'center'

export const isVerticalDrag = (dx: number, dy: number) =>
  Math.abs(dy) >= 14 && Math.abs(dy) > Math.abs(dx) * 1.5

export const volumeAfterDrag = (startVolume: number, dy: number, height: number) =>
  height <= 0 ? startVolume : Math.min(1, Math.max(0, startVolume - dy / (height * 0.6)))
