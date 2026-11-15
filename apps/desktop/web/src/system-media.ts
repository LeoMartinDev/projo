import type { SystemMedia, SystemMediaAction, SystemMediaRequest } from '@projo/web-app/host'

/** The part of the desktop app's IPC the system media controls use (§28.6). */
export type SystemMediaIpc = {
  invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown>
  /** Listens to an event the app emits; resolves to the function that stops. */
  listen: (event: string, handle: (payload: unknown) => void) => Promise<() => void>
}

const actionEvent = 'media://action'

const knownActions: ReadonlySet<string> = new Set<SystemMediaAction>([
  'play',
  'pause',
  'seekbackward',
  'seekforward',
  'seekto',
  'nexttrack',
])

/** The request a `media://action` payload carries; undefined for anything else. */
export const systemMediaRequestOf = (payload: unknown): SystemMediaRequest | undefined => {
  if (Object(payload) !== payload) return undefined
  const { action, seekTimeMs } = payload as Record<string, unknown>
  if (typeof action !== 'string' || !knownActions.has(action)) return undefined
  if (action !== 'seekto') return { action: action as Exclude<SystemMediaAction, 'seekto'> }
  return typeof seekTimeMs === 'number' && Number.isFinite(seekTimeMs) && seekTimeMs >= 0
    ? { action, seekTimeMs }
    : undefined
}

/**
 * Windows' System Media Transport Controls, held by the desktop app (§28.6): what plays, where,
 * and the actions the keys and the overlay ask for. Commands are fire-and-forget: a failure is
 * warned about, never thrown at the player. The app's event is listened to on the first
 * `onAction`, then kept for the page's life.
 */
export const desktopSystemMedia = (
  ipc: SystemMediaIpc,
  warn: (message: string, error: unknown) => void = (message, error) =>
    console.warn(message, error),
): SystemMedia => {
  const listeners = new Set<(request: SystemMediaRequest) => void>()
  let listening = false
  const send = (command: string, args?: Record<string, unknown>) => {
    void Promise.resolve()
      .then(() => ipc.invoke(command, args))
      .catch((error: unknown) => warn(`${command} failed`, error))
  }
  const listen = () => {
    if (listening) return
    listening = true
    void Promise.resolve()
      .then(() =>
        ipc.listen(actionEvent, (payload) => {
          const request = systemMediaRequestOf(payload)
          if (request === undefined) return
          for (const listener of listeners) listener(request)
        }),
      )
      .catch((error: unknown) => {
        // A later `onAction` tries again.
        listening = false
        warn(`listening to ${actionEvent} failed`, error)
      })
  }
  return {
    set: ({ title, subtitle, artworkUrl, actions }) =>
      send('media_session_set', {
        title,
        ...(subtitle === undefined ? {} : { subtitle }),
        ...(artworkUrl === undefined ? {} : { artworkUrl }),
        actions: [...actions],
      }),
    position: ({ playing, positionMs, durationMs, rate }) =>
      send('media_session_state', {
        playing,
        positionMs: Math.round(positionMs),
        durationMs: Math.round(durationMs),
        rate,
      }),
    clear: () => send('media_session_clear'),
    onAction: (listener) => {
      listeners.add(listener)
      listen()
      return () => {
        listeners.delete(listener)
      }
    },
  }
}
