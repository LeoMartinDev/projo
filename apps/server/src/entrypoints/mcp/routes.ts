import { Hono } from 'hono'

import { appError, type AppError, fromPromise, type Result } from '@projo/shared'
import { mcpPath } from '@projo/shared/api/assistants'

import type { RateLimiter } from '../../core/auth/ports.ts'
import { clientInfo } from '../http/client-info.ts'
import type { AppEnv } from '../http/context.ts'
import { statusForError } from '../http/error-mapping.ts'
import { errorBody, respondError } from '../http/errors.ts'
import type { McpProtocol } from './protocol.ts'

/** Who a credential of `/mcp` acts as (§27.3): an assistant token or an OAuth access token. */
export type McpPrincipal = {
  /** Rate-limit and log key: the token or the OAuth grant. */
  credentialId: string
  accountId: string
  profileId: string
}

export type McpAuthenticate = (
  token: string,
) => Result<
  McpPrincipal,
  AppError<
    | 'auth/unauthenticated'
    | 'auth/session_revoked'
    | 'auth/session_expired'
    | 'auth/account_disabled'
    | 'auth/forbidden'
    | 'auth/restricted_profile'
  >
>

/** Where an OAuth client finds how to sign in (§27.3 discovery). */
export const protectedResourceMetadataPath = '/.well-known/oauth-protected-resource'

const bearer = (header: string | undefined): string | undefined =>
  header?.match(/^Bearer\s+(\S+)\s*$/i)?.[1]

/**
 * `POST /mcp` (§27.2): a bearer of §27.3, the `Origin` check, the rate limit, then one JSON-RPC
 * message. A 401 carries the `WWW-Authenticate` pointer an OAuth client starts from.
 */
export const mcpRoutes = ({
  protocol,
  authenticate,
  rateLimiter,
  trustProxy,
}: {
  protocol: McpProtocol
  authenticate: McpAuthenticate
  rateLimiter: RateLimiter
  trustProxy: boolean
}) =>
  new Hono<AppEnv>()
    .post(mcpPath, async (c) => {
      const client = clientInfo(c, { trustProxy })
      const origin = c.req.header('origin')
      if (origin !== undefined && origin !== client.origin) {
        return respondError(
          c,
          appError('auth/origin_mismatch', 'request origin not allowed', {
            context: { origin, expected: client.origin },
          }),
        )
      }

      const unauthorized = (error: AppError) => {
        if (statusForError(error.code) === 401) {
          c.header(
            'WWW-Authenticate',
            `Bearer resource_metadata="${client.origin}${protectedResourceMetadataPath}", scope="review"`,
          )
        }
        return respondError(c, error)
      }
      const token = bearer(c.req.header('authorization'))
      if (token === undefined) {
        return unauthorized(appError('auth/unauthenticated', 'a bearer token is required'))
      }
      const principal = authenticate(token)
      if (!principal.ok) return unauthorized(principal.error)
      const { credentialId, accountId, profileId } = principal.value

      const retryAfterMs = rateLimiter.blockedFor(credentialId)
      if (retryAfterMs !== undefined) {
        c.header('Retry-After', String(Math.ceil(retryAfterMs / 1000)))
        return respondError(
          c,
          appError('auth/rate_limited', 'too many MCP requests', { context: { retryAfterMs } }),
        )
      }
      rateLimiter.hit(credentialId)

      const message = await fromPromise(
        () => c.req.json<unknown>(),
        () => undefined,
      )
      if (!message.ok) {
        return c.json(
          { jsonrpc: '2.0', error: { code: -32700, message: 'invalid JSON' } } as const,
          400,
        )
      }
      const logger = c.get('logger').child({ accountId, credentialId })
      const response = await protocol.handle(message.value, { accountId, profileId, logger })
      // A notification: accepted, nothing to answer.
      if (response === undefined) return c.newResponse(undefined as never, 202)
      return c.json(response, 200)
    })
    .on(['GET', 'DELETE'], mcpPath, (c) => {
      c.header('Allow', 'POST')
      return c.json(
        errorBody(appError('common/method_not_allowed', 'the MCP endpoint only takes POST')),
        405,
      )
    })

export type McpRoutes = ReturnType<typeof mcpRoutes>
