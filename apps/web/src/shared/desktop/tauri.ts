// What Tauri injects in every page of the desktop app's window (the server
// origin gets its IPC from a capability granted at runtime, §28.4).
export type TauriInternals = {
  invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown>
  transformCallback: (callback: (message: unknown) => void, once?: boolean) => number
  metadata?: { currentWindow?: { label?: string } }
}

export type TauriWindow = Window & {
  __TAURI_INTERNALS__?: TauriInternals
  __TAURI_EVENT_PLUGIN_INTERNALS__?: { unregisterListener?: (event: string, id: number) => void }
}

export const tauriInternals = (): TauriInternals | undefined =>
  (window as TauriWindow).__TAURI_INTERNALS__
