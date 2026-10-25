export type SleepOutcome = 'elapsed' | 'aborted'

export type Clock = {
  now: () => number
  sleep: (ms: number, signal?: AbortSignal) => Promise<SleepOutcome>
}

export const systemClock: Clock = {
  now: () => Date.now(),
  sleep: (ms, signal) =>
    new Promise((resolve) => {
      if (signal?.aborted) return resolve('aborted')
      const onAbort = () => {
        clearTimeout(timer)
        resolve('aborted')
      }
      const timer = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort)
        resolve('elapsed')
      }, ms)
      signal?.addEventListener('abort', onAbort, { once: true })
    }),
}
