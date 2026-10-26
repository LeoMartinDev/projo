import { healthResponseSchema } from '@projo/shared/api/common'
import { err, fromPromise, ok, type Result } from '@projo/shared/result'

import { compareSemVer, parseSemVer } from '../../shared/version/semver.ts'
import { type ConnectionError, connectionError } from './connection-error.ts'

/** The slice of `fetch` the check needs (injected: tests pass a fake). */
export type HealthFetch = (
  url: string,
  init: { signal: AbortSignal; headers: Record<string, string> },
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>

export type ServerStatus =
  | { readonly kind: 'compatible'; readonly version: string }
  | { readonly kind: 'outdated'; readonly version: string; readonly minimumVersion: string }

export type ServerCheckError = ConnectionError<'network' | 'connection/not_projo'>

type Deps = { fetch: HealthFetch; minimumServerVersion: string; timeoutMs: number }

const unreadable = Symbol('unreadable body')

/**
 * `GET <server>/health` (outside `/api/v1`, no auth, §17.2) → is this a projo server, and recent
 * enough for the app (§26.4)? Unknown fields of the response are ignored (§17.1).
 */
export const checkServerFactory = ({ fetch, minimumServerVersion, timeoutMs }: Deps) => {
  const minimum = parseSemVer(minimumServerVersion)
  if (minimum === undefined)
    throw new Error(`minimum server version is not semver: ${minimumServerVersion}`)

  return async (serverUrl: string): Promise<Result<ServerStatus, ServerCheckError>> => {
    const context = { url: serverUrl }
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    const response = await fromPromise(
      async () => {
        const answer = await fetch(`${serverUrl}/health`, {
          signal: controller.signal,
          headers: { accept: 'application/json', 'cache-control': 'no-cache' },
        })
        const body = answer.ok ? await answer.json().catch(() => unreadable) : unreadable
        return { status: answer.status, ok: answer.ok, body }
      },
      (cause) => connectionError('network', 'server unreachable', { context, cause }),
    ).finally(() => clearTimeout(timer))
    if (!response.ok) return response
    const { status, body } = response.value

    // A reverse proxy answers 502–504 while projo is down: that is "not responding", not "not projo".
    if (status >= 500)
      return err(connectionError('network', 'server error', { context: { ...context, status } }))
    const health = healthResponseSchema.safeParse(body)
    if (!response.value.ok || !health.success)
      return err(
        connectionError('connection/not_projo', 'no projo health response', {
          context: { ...context, status },
        }),
      )
    const { version } = health.data
    const actual = parseSemVer(version)
    if (actual === undefined)
      return err(
        connectionError('connection/not_projo', 'server version is not semver', {
          context: { ...context, version },
        }),
      )
    return ok(
      compareSemVer(actual, minimum) < 0
        ? { kind: 'outdated', version, minimumVersion: minimumServerVersion }
        : { kind: 'compatible', version },
    )
  }
}

export type CheckServer = ReturnType<typeof checkServerFactory>
