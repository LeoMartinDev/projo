import { hc } from 'hono/client'

import type { AppType } from '@projo/server/api-type'
import { profileIdHeader } from '@projo/shared/api/auth'

import { boundHost } from '../host/bound-host.ts'
import { getActiveProfileId } from '../session/active-profile.ts'
import { type ApiFailure, failureFromResponse, networkFailure } from './failure.ts'

export const apiPrefix = '/api/v1'

/** The active profile's header (§14), for the requests made outside the API client. */
export const profileHeaders = (): Record<string, string> => {
  const profileId = getActiveProfileId()
  return profileId === undefined ? {} : { [profileIdHeader]: profileId }
}

/** A request to the server through the host (its origin and credentials); `path` from the root. */
export const serverFetch = (path: string, init?: RequestInit): Promise<Response> =>
  boundHost().apiFetch(path, init)

// hc builds root-relative URLs from `apiPrefix`; the host resolves them and adds its credentials.
const hostFetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> =>
  serverFetch(
    typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
    init,
  )

export const api = hc<AppType>(apiPrefix, {
  fetch: hostFetch as typeof fetch,
  headers: profileHeaders,
})

export type ApiClient = typeof api

type AnyResponse = { ok: boolean; status: number; json: () => Promise<unknown> }

export type OkBody<R> = R extends { ok: true; json: () => Promise<infer T> } ? T : never

export const request = async <R extends AnyResponse>(
  call: () => Promise<R>,
): Promise<OkBody<R>> => {
  const response = await call().catch((cause: unknown): never => {
    throw networkFailure(cause)
  })
  if (!response.ok) throw await failureFromResponse(response)
  if (response.status === 204) return undefined as OkBody<R>
  return (await response.json()) as OkBody<R>
}

declare module '@tanstack/react-query' {
  interface Register {
    defaultError: ApiFailure
  }
}
