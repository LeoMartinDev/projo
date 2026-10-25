import { hc } from 'hono/client'

import type { AppType } from '@projo/server/api-type'
import { profileIdHeader } from '@projo/shared/api/auth'

import { getActiveProfileId } from '../session/active-profile.ts'
import { type ApiFailure, failureFromResponse, networkFailure } from './failure.ts'

export const apiPrefix = '/api/v1'

/**
 * Typed RPC client on `/api/v1` (§17.1). Same origin: cookies are sent automatically. The active
 * profile travels in `X-Profile-Id`.
 */
export const api = hc<AppType>(apiPrefix, {
  init: { credentials: 'same-origin' },
  headers: (): Record<string, string> => {
    const profileId = getActiveProfileId()
    return profileId === undefined ? {} : { [profileIdHeader]: profileId }
  },
})

export type ApiClient = typeof api

type AnyResponse = { ok: boolean; status: number; json: () => Promise<unknown> }

/** Body type of the 2xx branch of a Hono RPC response union. */
export type OkBody<R> = R extends { ok: true; json: () => Promise<infer T> } ? T : never

/**
 * Runs an RPC call; resolves with the success body, rejects with an `ApiFailure` (the shape
 * TanStack Query expects from a `queryFn`). A 204 resolves with `undefined`.
 */
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
