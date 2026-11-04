import { useEffect, useSyncExternalStore } from 'react'

import { eventHub } from '../events/events.ts'
import { readHealth } from './health.ts'
import { appUpdater } from './service-worker.ts'
import { createUpdateWatcher } from './update-watcher.ts'

const resumeCheckEveryMs = 30_000

export const isPlayerPath = (pathname: string): boolean => pathname.startsWith('/watch/')

let booted = false

const watcher = createUpdateWatcher({
  readServerVersion: async () => (await readHealth())?.version,
  webVersion: () => __PROJO_VERSION__,
  updater: appUpdater,
  isHidden: () => document.visibilityState === 'hidden',
  isPlaying: () => isPlayerPath(window.location.pathname),
})

export const useAppUpdate = (): { offered: boolean; apply: () => void } => {
  const offered = useSyncExternalStore(watcher.subscribe, watcher.offered)

  useEffect(() => {
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
    if (!booted) {
      booted = true
      void watcher.check('boot')
    }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pageshow', onPageShow)
    const stopReconnect = eventHub.onReconnect(() => void watcher.check('reconnect'))
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pageshow', onPageShow)
      stopReconnect()
    }
  }, [])

  return { offered: offered !== undefined, apply: () => void watcher.applyOffered() }
}
