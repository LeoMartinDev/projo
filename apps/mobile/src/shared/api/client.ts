import { err, fromPromise, ok, type Result } from '@projo/shared/result'
import { hc } from 'hono/client'
import type { z } from 'zod'

import type { AppType } from '@projo/server/api-type'
import { profileIdHeader } from '@projo/shared/api/auth'

import { getCredentials } from './credentials.ts'
import { type Failure, failure, failureFromBody } from './failure.ts'

export const apiPrefix = '/api/v1'

type ClientOptions = {
  /**
   * Sends the device's bearer token and active profile (`getCredentials`). A 401 to a request
   * that carried the token calls `onUnauthorized`: the session is gone (expired, revoked, §26.3).
   */
  authenticated?: { onUnauthorized: () => void }
}

/**
 * Typed RPC client of the server's `/api/v1` (§17.1). Only the type comes from `@projo/server`:
 * no server code reaches the app bundle.
 */
export const createApiClient = (serverUrl: string, { authenticated }: ClientOptions = {}) =>
  hc<AppType>(`${serverUrl}${apiPrefix}`, {
    ...(authenticated === undefined
      ? {}
      : {
          headers: (): Record<string, string> => {
            const { token, profileId } = getCredentials()
            return {
              ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
              ...(profileId === undefined ? {} : { [profileIdHeader]: profileId }),
            }
          },
          fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
            const sentToken = getCredentials().token !== undefined
            const response = await fetch(input instanceof URL ? input.href : input, init)
            if (response.status === 401 && sentToken) authenticated.onUnauthorized()
            return response
          },
        }),
  })

export type ApiClient = ReturnType<typeof createApiClient>

type AnyResponse = { ok: boolean; status: number; json: () => Promise<unknown> }

/**
 * Runs an RPC call. The 2xx body is parsed with `schema` (§26.4: unknown fields are dropped, never
 * rejected; a body that does not match is `unknown`), a 204 is `undefined`, anything else the
 * API's error as a `Failure`; no answer at all is `network`.
 */
export const requestApi = async <T>(
  call: () => Promise<AnyResponse>,
  schema?: z.ZodType<T>,
): Promise<Result<T, Failure>> => {
  const response = await fromPromise(call, (cause) =>
    failure('network', 'server unreachable', { cause }),
  )
  if (!response.ok) return response
  const answer = response.value
  const { status } = answer
  // `json` stays a method call: a detached `Response.json` loses its `this`.
  const body: unknown = status === 204 ? undefined : await answer.json().catch(() => undefined)
  if (!answer.ok) return err(failureFromBody(status, body))
  if (schema === undefined) return ok(body as T)
  const parsed = schema.safeParse(body)
  return parsed.success
    ? ok(parsed.data)
    : err(failure('unknown', 'unexpected response body', { status }))
}
