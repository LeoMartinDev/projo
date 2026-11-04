import { z } from 'zod'

import { passwordSchema, usernameSchema } from './auth.ts'
import { firstProfileSchema } from './accounts.ts'
import { uiLocaleSchema } from './profiles.ts'

export const invitationStateSchema = z.enum(['pending', 'used', 'expired'])
export type InvitationState = z.infer<typeof invitationStateSchema>

const accountRefSchema = z.object({ id: z.string(), username: z.string() })

export const invitationDtoSchema = z.object({
  id: z.string(),
  createdBy: accountRefSchema.optional(),
  expiresAt: z.string(),
  state: invitationStateSchema,
  usedAt: z.string().optional(),
  usedBy: accountRefSchema.optional(),
})
export type InvitationDto = z.infer<typeof invitationDtoSchema>

export const invitationsResponseSchema = z.object({ items: z.array(invitationDtoSchema) })
export type InvitationsResponse = z.infer<typeof invitationsResponseSchema>

export const createInvitationResponseSchema = z.object({
  invitation: invitationDtoSchema,
  token: z.string(),
})
export type CreateInvitationResponse = z.infer<typeof createInvitationResponseSchema>

export const invitationStatusResponseSchema = z.object({
  expiresAt: z.string(),
  serverName: z.string().optional(),
})
export type InvitationStatusResponse = z.infer<typeof invitationStatusResponseSchema>

export const acceptInvitationBodySchema = z.object({
  username: usernameSchema,
  password: passwordSchema,
  uiLocale: uiLocaleSchema.default('fr'),
  profile: firstProfileSchema,
})
export type AcceptInvitationBody = z.input<typeof acceptInvitationBodySchema>
