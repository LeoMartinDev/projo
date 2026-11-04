import { type Context, Hono } from 'hono'
import { z } from 'zod'

import { fromPromise } from '@projo/shared'
import { mcpPath } from '@projo/shared/api/assistants'

import type { OAuth } from '../../application/auth/oauth.ts'
import type { RateLimiter } from '../../core/auth/ports.ts'
import { oauthScopes } from '../../core/auth/oauth.ts'
import { clientInfo } from '../http/client-info.ts'
import type { AppEnv } from '../http/context.ts'
import { protectedResourceMetadataPath } from '../mcp/routes.ts'

const authorizationServerMetadataPath = '/.well-known/oauth-authorization-server'

/** RFC 6749 §5.2 / RFC 7591 §3.2.2 error bodies, never cached. */
const oauthError = (c: Context, error: string, description: string, status: 400 | 401 | 429) => {
  c.header('Cache-Control', 'no-store')
  return c.json({ error, error_description: description }, status)
}

const registerBodySchema = z.object({
  client_name: z.string().max(200).optional(),
  redirect_uris: z.array(z.string().max(2048)).min(1).max(20),
  token_endpoint_auth_method: z.string().optional(),
})

const tokenFormSchema = z.discriminatedUnion('grant_type', [
  z.object({
    grant_type: z.literal('authorization_code'),
    code: z.string().min(1),
    code_verifier: z.string().min(1),
    redirect_uri: z.string().min(1),
    client_id: z.string().min(1),
  }),
  z.object({
    grant_type: z.literal('refresh_token'),
    refresh_token: z.string().min(1),
    client_id: z.string().min(1).optional(),
  }),
])

const errorStrings = {
  'oauth/invalid_grant': 'invalid_grant',
  'oauth/invalid_client': 'invalid_client',
  'oauth/invalid_redirect_uri': 'invalid_redirect_uri',
  'oauth/invalid_request': 'invalid_client_metadata',
} as const

/**
 * The machine side of §27.3, outside `/api/v1`: discovery documents, client registration
 * (RFC 7591) and the token endpoint. The consent page is the web app's `/oauth/authorize`.
 */
export const oauthRoutes = ({
  oauth,
  registrationLimiter,
  tokenFailureLimiter,
  trustProxy,
}: {
  oauth: OAuth
  /** §27.3: 10 registrations per hour per IP. */
  registrationLimiter: RateLimiter
  /** §27.3: 20 failed token requests per 15 min per IP. */
  tokenFailureLimiter: RateLimiter
  trustProxy: boolean
}) => {
  const protectedResource = (c: Context<AppEnv>) => {
    const { origin } = clientInfo(c, { trustProxy })
    return c.json(
      {
        resource: `${origin}${mcpPath}`,
        authorization_servers: [origin],
        scopes_supported: [...oauthScopes],
        bearer_methods_supported: ['header'],
        resource_name: 'projo',
      },
      200,
    )
  }
  const authorizationServer = (c: Context<AppEnv>) => {
    const { origin } = clientInfo(c, { trustProxy })
    return c.json(
      {
        issuer: origin,
        authorization_endpoint: `${origin}/oauth/authorize`,
        token_endpoint: `${origin}/oauth/token`,
        registration_endpoint: `${origin}/oauth/register`,
        response_types_supported: ['code'],
        grant_types_supported: ['authorization_code', 'refresh_token'],
        code_challenge_methods_supported: ['S256'],
        token_endpoint_auth_methods_supported: ['none'],
        client_id_metadata_document_supported: true,
        scopes_supported: [...oauthScopes],
      },
      200,
    )
  }

  return new Hono<AppEnv>()
    .get(protectedResourceMetadataPath, protectedResource)
    .get(`${protectedResourceMetadataPath}${mcpPath}`, protectedResource)
    .get(authorizationServerMetadataPath, authorizationServer)
    .get('/.well-known/openid-configuration', authorizationServer)
    .post('/oauth/register', async (c) => {
      const { ip } = clientInfo(c, { trustProxy })
      if (registrationLimiter.blockedFor(ip) !== undefined) {
        return oauthError(c, 'invalid_request', 'too many registrations', 429)
      }
      registrationLimiter.hit(ip)
      const json = await fromPromise(
        () => c.req.json<unknown>(),
        () => undefined,
      )
      const body = registerBodySchema.safeParse(json.ok ? json.value : undefined)
      if (!body.success) return oauthError(c, 'invalid_client_metadata', 'invalid metadata', 400)
      const client = oauth.register({
        redirectUris: body.data.redirect_uris,
        ...(body.data.client_name === undefined ? {} : { clientName: body.data.client_name }),
      })
      if (!client.ok) {
        return oauthError(c, errorStrings[client.error.code], client.error.message, 400)
      }
      c.header('Cache-Control', 'no-store')
      return c.json(
        {
          client_id: client.value.clientId,
          client_id_issued_at: Math.floor(client.value.createdAt.getTime() / 1000),
          client_name: client.value.name,
          redirect_uris: client.value.redirectUris,
          token_endpoint_auth_method: 'none',
          grant_types: ['authorization_code', 'refresh_token'],
          response_types: ['code'],
        },
        201,
      )
    })
    .post('/oauth/token', async (c) => {
      const { ip } = clientInfo(c, { trustProxy })
      if (tokenFailureLimiter.blockedFor(ip) !== undefined) {
        return oauthError(c, 'invalid_request', 'too many failed attempts', 429)
      }
      const form = await fromPromise(
        () => c.req.parseBody(),
        () => undefined,
      )
      const parsed = tokenFormSchema.safeParse(form.ok ? form.value : undefined)
      if (!parsed.success) {
        tokenFailureLimiter.hit(ip)
        const grantType = form.ok ? form.value['grant_type'] : undefined
        return typeof grantType === 'string' &&
          grantType !== 'authorization_code' &&
          grantType !== 'refresh_token'
          ? oauthError(c, 'unsupported_grant_type', 'unsupported grant_type', 400)
          : oauthError(c, 'invalid_request', 'invalid token request', 400)
      }
      const data = parsed.data
      const result = await oauth.token(
        data.grant_type === 'authorization_code'
          ? {
              grantType: 'authorization_code',
              code: data.code,
              codeVerifier: data.code_verifier,
              redirectUri: data.redirect_uri,
              clientId: data.client_id,
            }
          : {
              grantType: 'refresh_token',
              refreshToken: data.refresh_token,
              ...(data.client_id === undefined ? {} : { clientId: data.client_id }),
            },
      )
      if (!result.ok) {
        tokenFailureLimiter.hit(ip)
        return oauthError(c, errorStrings[result.error.code], result.error.message, 400)
      }
      c.header('Cache-Control', 'no-store')
      return c.json(result.value, 200)
    })
    .on(['GET'], ['/oauth/token', '/oauth/register'], (c) =>
      oauthError(c, 'invalid_request', 'POST only', 400),
    )
}

export type OAuthRoutes = ReturnType<typeof oauthRoutes>
