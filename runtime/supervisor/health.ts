import type { Clock } from './clock'
import { supervisorError, type SupervisorError } from './errors'
import { err, ok, type Result } from './result'

export type HealthError = SupervisorError<'health/unreachable' | 'health/unhealthy'>
export type HealthProbe = () => Promise<Result<void, HealthError>>

export const healthUrl = (port: number): string => `http://127.0.0.1:${port}/health`

export const httpHealthProbeFactory =
  ({
    url,
    timeoutMs,
    fetch = globalThis.fetch,
  }: {
    url: string
    timeoutMs: number
    fetch?: typeof globalThis.fetch
  }): HealthProbe =>
  async () => {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
      await response.body?.cancel()
      return response.ok
        ? ok(undefined)
        : err(
            supervisorError('health/unhealthy', 'Health endpoint returned an error status', {
              url,
              status: response.status,
            }),
          )
    } catch (cause) {
      return err(
        supervisorError('health/unreachable', 'Health endpoint is unreachable', { url }, cause),
      )
    }
  }

/** Polls until healthy or `timeoutMs` elapses: the 60 s window after a version switch (§16.3). */
export const waitForHealthFactory =
  ({ probe, clock }: { probe: HealthProbe; clock: Clock }) =>
  async ({
    timeoutMs,
    intervalMs,
    signal,
  }: {
    timeoutMs: number
    intervalMs: number
    signal?: AbortSignal
  }): Promise<Result<void, HealthError>> => {
    const deadline = clock.now() + timeoutMs
    for (;;) {
      const result = await probe()
      if (result.ok || clock.now() + intervalMs > deadline) return result
      if ((await clock.sleep(intervalMs, signal)) === 'aborted') return result
    }
  }
