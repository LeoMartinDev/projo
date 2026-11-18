import type { LiveTimers } from '../../core/tv/live.ts'

export const systemTimers: LiveTimers = {
  after: (ms, run) => {
    const timer = setTimeout(run, ms)
    return () => clearTimeout(timer)
  },
}
