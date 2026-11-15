import type { HostUpdates } from '@projo/web-app/host'

// TRANSITIONAL (§28), for desktop-compat.tsx: the server's new web app first (a reload), then
// the desktop app's update (a restart), as an old desktop app's window offered them.
export const eitherUpdate = (first: HostUpdates, second: HostUpdates): HostUpdates => ({
  start: (app) => {
    const stops = [first.start(app), second.start(app)]
    return () => {
      for (const stop of stops) stop()
    }
  },
  offered: () => first.offered() ?? second.offered(),
  subscribe: (listener) => {
    const stops = [first.subscribe(listener), second.subscribe(listener)]
    return () => {
      for (const stop of stops) stop()
    }
  },
  apply: () => (first.offered() === undefined ? second.apply() : first.apply()),
})
