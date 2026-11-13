/**
 * The desktop app's libmpv, as the IPC contract of PRODUCT.md §28.6 gives it
 * to the page. The engine only talks to this port: the Tauri bridge in the
 * desktop app, a replay of recorded libmpv sequences in tests.
 */

export const mpvEventNames = [
  'file-loaded',
  'playback-restart',
  'seek',
  'end-file',
  'shutdown',
] as const
export type MpvEventName = (typeof mpvEventNames)[number]

export const mpvEndReasons = ['eof', 'stop', 'quit', 'error', 'redirect'] as const
export type MpvEndReason = (typeof mpvEndReasons)[number]

// `mpv://property` and `mpv://event`, as one stream in the order they came.
export type MpvMessage =
  | { kind: 'property'; name: string; value?: unknown }
  | { kind: 'event'; event: MpvEventName; reason?: MpvEndReason; error?: string }

export type DesktopInfo = { version: string; mpv: string }

export type MpvBridge = {
  // Creates the instance if there is none (`mpv_init`).
  init: (options: Record<string, string>) => Promise<void>
  command: (args: string[]) => Promise<void>
  setProperty: (name: string, value: string) => Promise<void>
  // Undefined when the property has no value now.
  getProperty: (name: string) => Promise<unknown>
  observe: (names: string[]) => Promise<void>
  // Stops playback, hides the picture and destroys the instance (`mpv_destroy`).
  destroy: () => Promise<void>
  info: () => Promise<DesktopInfo>
  // Every `mpv://property` and `mpv://event`; resolves to what stops listening.
  listen: (onMessage: (message: MpvMessage) => void) => Promise<() => void>
  // The window's full screen (§28.4: the page cannot fullscreen the window itself).
  setFullscreen: (fullscreen: boolean) => Promise<void>
  isFullscreen: () => Promise<boolean>
}

// A rejected IPC call: `{ code, message }` from the app, a string from Tauri itself.
export const bridgeErrorMessage = (error: unknown): string => {
  if (typeof error === 'string') return error
  if (typeof error === 'object' && Object(error) === error) {
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string') return message
  }
  return String(error)
}
