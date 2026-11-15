import type { HostUpdates } from '../host.ts'
import { listenTauri, stringField, type TauriInternals } from './tauri.ts'

/**
 * The desktop app's own update as the host's update source (§28.10): offered as `restart` once a
 * new version is downloaded and ready (`desktop_update_status`, then `desktop://update`); taking
 * it quits and starts again on that version. Nothing from an app older than these commands (it
 * refuses them).
 */
export const desktopUpdates = (internals: TauriInternals): HostUpdates => {
  let ready: string | undefined
  const listeners = new Set<() => void>()
  const offer = (version: string | undefined) => {
    if (version === undefined || version === ready) return
    ready = version
    for (const listener of listeners) listener()
  }
  return {
    start: () => {
      let active = true
      let stop: (() => void) | undefined
      void internals
        .invoke('desktop_update_status')
        .then((status) => active && offer(stringField(status, 'ready')))
        .catch(() => undefined)
      void listenTauri(internals, 'desktop://update', (payload) =>
        offer(stringField(payload, 'version')),
      )
        .then((unlisten) => (active ? (stop = unlisten) : unlisten()))
        .catch(() => undefined)
      return () => {
        active = false
        stop?.()
      }
    },
    offered: () => (ready === undefined ? undefined : 'restart'),
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    apply: async () => {
      await internals.invoke('desktop_update_install')
    },
  }
}
