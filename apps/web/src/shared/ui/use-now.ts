import { useSyncExternalStore } from 'react'

const tickMs = 15_000
let now = Date.now()
const listeners = new Set<() => void>()
let timer: ReturnType<typeof setInterval> | undefined

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  if (timer === undefined) {
    now = Date.now()
    timer = setInterval(() => {
      now = Date.now()
      for (const notify of listeners) notify()
    }, tickMs)
  }
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) {
      clearInterval(timer)
      timer = undefined
    }
  }
}

/** Current time, refreshed every 15 s: keeps "il y a 2 min" labels current. */
export const useNow = (): Date => new Date(useSyncExternalStore(subscribe, () => now))
