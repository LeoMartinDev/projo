import { z } from 'zod'

import { accountRoleSchema, passwordSchema, usernameSchema } from './auth.ts'
import {
  avatarColorSchema,
  profileDtoSchema,
  profileNameSchema,
  uiLocaleSchema,
} from './profiles.ts'

/** Schemas for `/api/v1/admin/accounts` (§15 Comptes, §17.2 Admin comptes). */

/** A profile in the admin list: its settings, and whether it is playing something right now. */
export const adminProfileDtoSchema = profileDtoSchema.extend({ playing: z.boolean() })
export type AdminProfileDto = z.infer<typeof adminProfileDtoSchema>

/**
 * An account with its profiles (artboard `AdminAccounts`). `lastSeenAt` / `lastDeviceName`: the
 * most recently used session (revoked or not), absent when the account never signed in.
 * `activeSessions`: sessions and tokens still valid. `playing`: one of its profiles has an active
 * playback session.
 */
export const adminAccountDtoSchema = z.object({
  id: z.string(),
  username: z.string(),
  role: accountRoleSchema,
  createdAt: z.string(),
  disabledAt: z.string().optional(),
  lastSeenAt: z.string().optional(),
  lastDeviceName: z.string().optional(),
  activeSessions: z.number().int(),
  playing: z.boolean(),
  profiles: z.array(adminProfileDtoSchema),
})
export type AdminAccountDto = z.infer<typeof adminAccountDtoSchema>

/** `GET /admin/accounts`: every account, oldest first. */
export const adminAccountsResponseSchema = z.object({ items: z.array(adminAccountDtoSchema) })
export type AdminAccountsResponse = z.infer<typeof adminAccountsResponseSchema>

/** First profile of a new account: name defaults to the username, colour to `blue`. */
export const firstProfileSchema = z
  .object({
    name: profileNameSchema.optional(),
    avatarColor: avatarColorSchema.optional(),
  })
  .default({})

/**
 * `POST /admin/accounts` (201 `AdminAccountDto`, 409 `auth/username_taken`): an account created
 * directly by the admin, with its first profile.
 */
export const createAccountBodySchema = z.object({
  username: usernameSchema,
  password: passwordSchema,
  role: accountRoleSchema.default('user'),
  uiLocale: uiLocaleSchema.default('fr'),
  profile: firstProfileSchema,
})
export type CreateAccountBody = z.input<typeof createAccountBodySchema>

/**
 * `PATCH /admin/accounts/:id` (200 `AdminAccountDto`). `disabled: true` revokes every session of
 * the account (data kept); `false` re-enables it. 409 `account/last_admin` when the change would
 * leave no enabled admin.
 */
export const updateAccountBodySchema = z
  .object({
    role: accountRoleSchema.optional(),
    disabled: z.boolean().optional(),
  })
  .refine((body) => body.role !== undefined || body.disabled !== undefined, {
    message: 'nothing to update',
  })
export type UpdateAccountBody = z.infer<typeof updateAccountBodySchema>

/**
 * `DELETE /admin/accounts/:id` (204): deletes the account and, in cascade, its profiles, sessions,
 * progress, lists and preferences. `confirmUsername` must repeat its username (case-insensitive,
 * 400 `account/confirmation_mismatch`). 409 `account/last_admin`.
 */
export const deleteAccountBodySchema = z.object({ confirmUsername: z.string().min(1).max(64) })
export type DeleteAccountBody = z.infer<typeof deleteAccountBodySchema>

/** `POST /admin/accounts/:id/reset-password` (204): new password, every session revoked. */
export const resetPasswordBodySchema = z.object({ password: passwordSchema })
export type ResetPasswordBody = z.infer<typeof resetPasswordBodySchema>

/**
 * `POST /admin/accounts/:id/profiles` (§15 Accounts): an admin adds a profile to an account (201
 * `ProfileDto`, 409 `profile/limit_reached` at 5, 404 `account/not_found`). Same body as
 * `POST /profiles`, without ceiling: library access and rating are the admin's.
 */
export { createProfileBodySchema as createAccountProfileBodySchema } from './profiles.ts'

/** One profile in "Profiles with access" of a library (§14, §15 Libraries). */
export const libraryProfileAccessDtoSchema = z.object({
  profileId: z.string(),
  name: z.string(),
  avatarColor: avatarColorSchema,
  accountId: z.string(),
  username: z.string(),
  /** `all`: sees every library, present and future. */
  libraryAccess: z.enum(['all', 'selected']),
  hasAccess: z.boolean(),
})
export type LibraryProfileAccessDto = z.infer<typeof libraryProfileAccessDtoSchema>

/** `GET/PUT /admin/libraries/:id/profiles`: every profile of every account, oldest account first. */
export const libraryProfileAccessResponseSchema = z.object({
  items: z.array(libraryProfileAccessDtoSchema),
})
export type LibraryProfileAccessResponse = z.infer<typeof libraryProfileAccessResponseSchema>

/**
 * `PUT /admin/libraries/:id/profiles`: exactly these profiles see the library afterwards. A
 * profile with `libraryAccess = all` that is left out switches to `selected` with every other
 * library; one added keeps its selection plus this library.
 */
export const setLibraryProfilesBodySchema = z.object({
  profileIds: z.array(z.string().min(1)).max(500),
})
export type SetLibraryProfilesBody = z.infer<typeof setLibraryProfilesBodySchema>
