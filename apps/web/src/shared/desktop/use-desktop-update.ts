import { useEffect, useState } from 'react'

import { listenTauri, tauriInternals } from './tauri.ts'

const stringField = (value: unknown, key: string): string | undefined => {
  const field = Object(value) === value ? (value as Record<string, unknown>)[key] : undefined
  return typeof field === 'string' && field !== '' ? field : undefined
}

/**
 * A new version of the desktop app, downloaded and ready (§28.10), and the way to restart on it.
 * Nothing in a browser, nor in an app older than these commands (it refuses them).
 */
export const useDesktopUpdate = (): {
  ready: string | undefined
  install: () => Promise<unknown>
} => {
  const [ready, setReady] = useState<string>()

  useEffect(() => {
    const internals = tauriInternals()
    if (internals === undefined) return
    let active = true
    let stop: (() => void) | undefined
    void internals
      .invoke('desktop_update_status')
      .then((status) => {
        const version = stringField(status, 'ready')
        if (active && version !== undefined) setReady(version)
      })
      .catch(() => undefined)
    void listenTauri(internals, 'desktop://update', (payload) => {
      const version = stringField(payload, 'version')
      if (version !== undefined) setReady(version)
    })
      .then((unlisten) => (active ? (stop = unlisten) : unlisten()))
      .catch(() => undefined)
    return () => {
      active = false
      stop?.()
    }
  }, [])

  return {
    ready,
    // On success the app quits, then starts again on the new version.
    install: async () => tauriInternals()?.invoke('desktop_update_install'),
  }
}
