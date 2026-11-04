import { err, fromPromise, ok, type Result } from '@projo/shared/result'
import { hc } from 'hono/client'
import type { z } from 'zod'

import type { AppType } from '@projo/server/api-type'
import { profileIdHeader } from '@projo/shared/api/auth'

import { getCredentials } from './credentials.ts'
import { type Failure, failure, failureFromBody } from './failure.ts'

export const apiPrefix = '/api/v1'

type ClientOptions = {
  authenticated?: { onUnauthorized: () => void }
}

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
  const body: unknown = status === 204 ? undefined : await answer.json().catch(() => undefined)
  if (!answer.ok) return err(failureFromBody(status, body))
  if (schema === undefined) return ok(body as T)
  const parsed = schema.safeParse(body)
  return parsed.success
    ? ok(parsed.data)
    : err(failure('unknown', 'unexpected response body', { status }))
}
