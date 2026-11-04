import { z } from 'zod'

import { accountRoleSchema, passwordSchema, usernameSchema } from './auth.ts'
import {
  avatarColorSchema,
  profileDtoSchema,
  profileNameSchema,
  uiLocaleSchema,
} from './profiles.ts'

export const adminProfileDtoSchema = profileDtoSchema.extend({ playing: z.boolean() })
export type AdminProfileDto = z.infer<typeof adminProfileDtoSchema>

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

export const adminAccountsResponseSchema = z.object({ items: z.array(adminAccountDtoSchema) })
export type AdminAccountsResponse = z.infer<typeof adminAccountsResponseSchema>

export const firstProfileSchema = z
  .object({
    name: profileNameSchema.optional(),
    avatarColor: avatarColorSchema.optional(),
  })
  .default({})

export const createAccountBodySchema = z.object({
  username: usernameSchema,
  password: passwordSchema,
  role: accountRoleSchema.default('user'),
  uiLocale: uiLocaleSchema.default('fr'),
  profile: firstProfileSchema,
})
export type CreateAccountBody = z.input<typeof createAccountBodySchema>

export const updateAccountBodySchema = z
  .object({
    role: accountRoleSchema.optional(),
    disabled: z.boolean().optional(),
  })
  .refine((body) => body.role !== undefined || body.disabled !== undefined, {
    message: 'nothing to update',
  })
export type UpdateAccountBody = z.infer<typeof updateAccountBodySchema>

export const deleteAccountBodySchema = z.object({ confirmUsername: z.string().min(1).max(64) })
export type DeleteAccountBody = z.infer<typeof deleteAccountBodySchema>

export const resetPasswordBodySchema = z.object({ password: passwordSchema })
export type ResetPasswordBody = z.infer<typeof resetPasswordBodySchema>

export { createProfileBodySchema as createAccountProfileBodySchema } from './profiles.ts'

export const libraryProfileAccessDtoSchema = z.object({
  profileId: z.string(),
  name: z.string(),
  avatarColor: avatarColorSchema,
  accountId: z.string(),
  username: z.string(),
  libraryAccess: z.enum(['all', 'selected']),
  hasAccess: z.boolean(),
})
export type LibraryProfileAccessDto = z.infer<typeof libraryProfileAccessDtoSchema>

export const libraryProfileAccessResponseSchema = z.object({
  items: z.array(libraryProfileAccessDtoSchema),
})
export type LibraryProfileAccessResponse = z.infer<typeof libraryProfileAccessResponseSchema>

export const setLibraryProfilesBodySchema = z.object({
  profileIds: z.array(z.string().min(1)).max(500),
})
export type SetLibraryProfilesBody = z.infer<typeof setLibraryProfilesBodySchema>
