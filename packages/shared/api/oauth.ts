import { z } from 'zod'

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

export const oauthConsentDtoSchema = z.object({
  client: z.object({
    name: z.string(),
    redirectHost: z.string(),
    loopback: z.boolean(),
  }),
  canAuthorize: z.boolean(),
  profile: z.object({ id: z.string(), name: z.string() }).optional(),
})
export type OAuthConsentDto = z.infer<typeof oauthConsentDtoSchema>

export const oauthDecisionBodySchema = oauthAuthorizeQuerySchema.extend({
  decision: z.enum(['allow', 'deny']),
})
export type OAuthDecisionBody = z.infer<typeof oauthDecisionBodySchema>

export const oauthDecisionResponseSchema = z.object({ redirectTo: z.string() })
export type OAuthDecisionResponse = z.infer<typeof oauthDecisionResponseSchema>
