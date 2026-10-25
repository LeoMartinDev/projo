import { z } from 'zod'

import { passwordSchema, usernameSchema } from './auth.ts'
import { firstProfileSchema } from './accounts.ts'
import { uiLocaleSchema } from './profiles.ts'

/** Schemas for `/api/v1/invitations` and `/api/v1/admin/invitations` (§14 Invitations). */

/** `pending` until accepted (`used`) or past its 7 days (`expired`). */
export const invitationStateSchema = z.enum(['pending', 'used', 'expired'])
export type InvitationState = z.infer<typeof invitationStateSchema>

const accountRefSchema = z.object({ id: z.string(), username: z.string() })

/**
 * `createdBy` is absent when the admin who created the invitation was deleted since, `usedBy`
 * when the account created by the invitation was.
 */
export const invitationDtoSchema = z.object({
  id: z.string(),
  createdBy: accountRefSchema.optional(),
  expiresAt: z.string(),
  state: invitationStateSchema,
  usedAt: z.string().optional(),
  usedBy: accountRefSchema.optional(),
})
export type InvitationDto = z.infer<typeof invitationDtoSchema>

/** `GET /admin/invitations`: every invitation, the most recent first. */
export const invitationsResponseSchema = z.object({ items: z.array(invitationDtoSchema) })
export type InvitationsResponse = z.infer<typeof invitationsResponseSchema>

/**
 * `POST /admin/invitations` (201): a single-use link valid 7 days. `token` is shown this once
 * (only its hash is stored); the web builds the link (`<origin>/invitation/<token>` or similar)
 * and calls `/invitations/:token` with it. `DELETE /admin/invitations/:id` withdraws one (204).
 */
export const createInvitationResponseSchema = z.object({
  invitation: invitationDtoSchema,
  token: z.string(),
})
export type CreateInvitationResponse = z.infer<typeof createInvitationResponseSchema>

/**
 * `GET /invitations/:token` (public): 200 while the invitation can be accepted; 404
 * `auth/invitation_invalid` (unknown or withdrawn), 410 `auth/invitation_expired`, 410
 * `auth/invitation_used`.
 */
export const invitationStatusResponseSchema = z.object({
  expiresAt: z.string(),
  serverName: z.string().optional(),
})
export type InvitationStatusResponse = z.infer<typeof invitationStatusResponseSchema>

/**
 * `POST /invitations/:token/accept` (public, 201 `MeResponse`, sets the session cookie): creates
 * a `user` account and its first profile, then signs in (the first profile is active). Same
 * errors as `GET`, plus 409 `auth/username_taken` and 429 `auth/rate_limited` (20 per hour per IP).
 */
export const acceptInvitationBodySchema = z.object({
  username: usernameSchema,
  password: passwordSchema,
  uiLocale: uiLocaleSchema.default('fr'),
  profile: firstProfileSchema,
})
export type AcceptInvitationBody = z.input<typeof acceptInvitationBodySchema>
