import type { HealthResponse } from '@projo/shared/api/common'
import type { HostUpdates } from '@projo/web-app/host'

import type { Updater } from './update-policy.ts'
import { createUpdateWatcher } from './update-watcher.ts'

const resumeCheckEveryMs = 30_000

const readServerVersion = async (): Promise<string | undefined> => {
  try {
    const response = await fetch('/health', { cache: 'no-store' })
    return response.ok ? ((await response.json()) as HealthResponse).version : undefined
  } catch {
    return undefined
  }
}

/**
 * The browser's update source (§16.4): the server's version (`/health`) against this build's,
 * checked at launch, when the page comes back and when the event stream reconnects; a newer one
 * reloads at once when nobody is looking, or is offered as `reload` (the service worker brings
 * the new build, `updater`).
 */
export const browserUpdates = ({
  version,
  updater,
}: {
  version: string
  updater: Updater
}): HostUpdates => {
  let isPlaying = () => false
  const watcher = createUpdateWatcher({
    readServerVersion,
    webVersion: () => version,
    updater,
    isHidden: () => document.visibilityState === 'hidden',
    isPlaying: () => isPlaying(),
  })
  return {
    start: (app) => {
      isPlaying = app.isPlaying
      let lastResumeCheck = Date.now()
      const resume = () => {
        if (Date.now() - lastResumeCheck < resumeCheckEveryMs) return
        lastResumeCheck = Date.now()
        void watcher.check('resume')
      }
      const onVisibility = () =>
        document.visibilityState === 'hidden' ? void watcher.hidden() : resume()
      const onPageShow = (event: PageTransitionEvent) => {
        if (event.persisted) resume()
      }
      void watcher.check('boot')
      document.addEventListener('visibilitychange', onVisibility)
      window.addEventListener('pageshow', onPageShow)
      const stopReconnect = app.onReconnect(() => void watcher.check('reconnect'))
      return () => {
        document.removeEventListener('visibilitychange', onVisibility)
        window.removeEventListener('pageshow', onPageShow)
        stopReconnect()
      }
    },
    offered: () => (watcher.offered() === undefined ? undefined : 'reload'),
    subscribe: watcher.subscribe,
    apply: () => watcher.applyOffered(),
  }
}
