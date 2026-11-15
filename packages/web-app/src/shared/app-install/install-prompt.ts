import { useSyncExternalStore } from 'react'

// Chromium's `beforeinstallprompt` event; not in lib.dom.
type InstallPromptEvent = Event & { prompt: () => Promise<unknown> }

const isInstallPrompt = (event: Event): event is InstallPromptEvent =>
  'prompt' in event && typeof event.prompt === 'function'

let deferred: InstallPromptEvent | undefined
const listeners = new Set<() => void>()

const setDeferred = (next: InstallPromptEvent | undefined) => {
  deferred = next
  for (const notify of listeners) notify()
}

// Called once at startup: the event may fire before React renders the menu.
export const trackInstallPrompt = () => {
  window.addEventListener('beforeinstallprompt', (event) => {
    if (!isInstallPrompt(event)) return
    event.preventDefault()
    setDeferred(event)
  })
  window.addEventListener('appinstalled', () => setDeferred(undefined))
}

const subscribe = (notify: () => void) => {
  listeners.add(notify)
  return () => {
    listeners.delete(notify)
  }
}

export const useCanPromptInstall = () =>
  useSyncExternalStore(
    subscribe,
    () => deferred !== undefined,
    () => false,
  )

// The event can be prompted only once; the browser fires a new one if the user dismisses it.
export const promptInstall = async () => {
  const event = deferred
  if (event === undefined) return
  setDeferred(undefined)
  await event.prompt()
}
