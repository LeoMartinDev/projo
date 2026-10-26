import { hc } from 'hono/client'

import type { AppType } from '@projo/server/api-type'

export const apiPrefix = '/api/v1'

/**
 * Typed RPC client of the server's `/api/v1` (§17.1). Only the type comes from `@projo/server`:
 * no server code reaches the app bundle.
 */
export const createApiClient = (serverUrl: string) => hc<AppType>(`${serverUrl}${apiPrefix}`)

export type ApiClient = ReturnType<typeof createApiClient>
