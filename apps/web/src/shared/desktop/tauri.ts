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

const payloadOf = (message: unknown): unknown =>
  Object(message) === message ? (message as Record<string, unknown>)['payload'] : undefined

/** Listens to an event the desktop app emits (§28.6); resolves to the function that stops. */
export const listenTauri = async (
  internals: TauriInternals,
  event: string,
  handle: (payload: unknown) => void,
): Promise<() => void> => {
  const handler = internals.transformCallback((message) => handle(payloadOf(message)))
  const id = await internals.invoke('plugin:event|listen', {
    event,
    target: { kind: 'Any' },
    handler,
  })
  return () => {
    if (typeof id !== 'number') return
    ;(window as TauriWindow).__TAURI_EVENT_PLUGIN_INTERNALS__?.unregisterListener?.(event, id)
    void internals.invoke('plugin:event|unlisten', { event, eventId: id }).catch(() => undefined)
  }
}
