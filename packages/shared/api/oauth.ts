import { z } from 'zod'

/**
 * OAuth 2.1 of the MCP server (§27.3). The consent page, `/oauth/authorize`, is a page of the web
 * app: it reads the client's query, asks `GET /api/v1/oauth/authorize` with it, and sends the
 * decision to `POST /api/v1/oauth/authorize`, then goes to `redirectTo`.
 */

/** The authorization request, as the client puts it in the query of `/oauth/authorize`. */
export const oauthAuthorizeQuerySchema = z.object({
  response_type: z.string(),
  client_id: z.string().min(1).max(2048),
  redirect_uri: z.string().min(1).max(2048),
  state: z.string().max(2048).optional(),
  code_challenge: z.string().min(43).max(128),
  code_challenge_method: z.string(),
  scope: z.string().max(512).optional(),
  resource: z.string().max(2048).optional(),
})
export type OAuthAuthorizeQuery = z.infer<typeof oauthAuthorizeQuerySchema>

/**
 * `GET /api/v1/oauth/authorize?…`: who asks, where the code goes back, and whether the signed-in
 * account may allow it (an admin on an unrestricted active profile, §15). `redirectHost` is shown
 * on the page; `loopback`: an app on this computer receives the code (a warning).
 */
export const oauthConsentDtoSchema = z.object({
  client: z.object({
    name: z.string(),
    redirectHost: z.string(),
    loopback: z.boolean(),
  }),
  canAuthorize: z.boolean(),
  /** The profile the assistant will act as: the active one. */
  profile: z.object({ id: z.string(), name: z.string() }).optional(),
})
export type OAuthConsentDto = z.infer<typeof oauthConsentDtoSchema>

/** `POST /api/v1/oauth/authorize`: the same query, and the decision. */
export const oauthDecisionBodySchema = oauthAuthorizeQuerySchema.extend({
  decision: z.enum(['allow', 'deny']),
})
export type OAuthDecisionBody = z.infer<typeof oauthDecisionBodySchema>

/** Where the browser goes next: the client's redirect URI with `code` (or `error`) and `state`. */
export const oauthDecisionResponseSchema = z.object({ redirectTo: z.string() })
export type OAuthDecisionResponse = z.infer<typeof oauthDecisionResponseSchema>
