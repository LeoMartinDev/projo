import { z } from 'zod'

import { type ProfileDto, profileDtoSchema } from './profiles.ts'

export const accountRoleSchema = z.enum(['admin', 'user'])
export type AccountRole = z.infer<typeof accountRoleSchema>

export const sessionKindSchema = z.enum(['cookie', 'bearer'])
export type SessionKind = z.infer<typeof sessionKindSchema>

export const sessionCookieName = 'projo_session'
export const profileIdHeader = 'X-Profile-Id'

export const usernameSchema = z
  .string()
  .min(3)
  .max(32)
  .regex(/^[A-Za-z0-9._-]+$/)
export const passwordSchema = z.string().min(12).max(256)

export const deviceNameSchema = z.string().trim().min(1).max(64)

export {
  type AvatarColor,
  avatarColorSchema,
  type ProfileDto,
  profileDtoSchema,
  profileNameSchema,
  type SubtitleMode,
  subtitleModeSchema,
  type UiLocale,
  uiLocaleSchema,
} from './profiles.ts'

export const accountDtoSchema = z.object({
  id: z.string(),
  username: z.string(),
  role: accountRoleSchema,
})
export type AccountDto = z.infer<typeof accountDtoSchema>

export const meResponseSchema = z.object({
  account: accountDtoSchema,
  profiles: z.array(profileDtoSchema),
  activeProfileId: z.string().optional(),
  needsProfileSelection: z.boolean(),
})
export type MeResponse = z.infer<typeof meResponseSchema>

export const loginBodySchema = z.object({
  username: z.string().min(1).max(64),
  password: z.string().min(1).max(256),
  deviceName: deviceNameSchema.optional(),
  token: z.boolean().optional(),
})
export type LoginBody = z.infer<typeof loginBodySchema>

export const loginResponseSchema = meResponseSchema.extend({ token: z.string().optional() })
export type LoginResponse = z.infer<typeof loginResponseSchema>

export const sessionDtoSchema = z.object({
  id: z.string(),
  kind: sessionKindSchema,
  deviceName: z.string(),
  userAgent: z.string(),
  createdAt: z.string(),
  lastSeenAt: z.string(),
  expiresAt: z.string(),
  current: z.boolean(),
})
export type SessionDto = z.infer<typeof sessionDtoSchema>

export const sessionsResponseSchema = z.object({ items: z.array(sessionDtoSchema) })
export type SessionsResponse = z.infer<typeof sessionsResponseSchema>

export const createTokenBodySchema = z.object({ deviceName: deviceNameSchema })
export type CreateTokenBody = z.infer<typeof createTokenBodySchema>

export const createTokenResponseSchema = z.object({
  token: z.string(),
  session: sessionDtoSchema,
})
export type CreateTokenResponse = z.infer<typeof createTokenResponseSchema>

export const changePasswordBodySchema = z.object({
  currentPassword: z.string().min(1).max(256),
  newPassword: passwordSchema,
})
export type ChangePasswordBody = z.infer<typeof changePasswordBodySchema>

export const pairingCodeAlphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
export const pairingCodeLength = 6
export const pairingPath = '/pair'

export const pairingUrl = ({ origin, code }: { origin: string; code: string }): string =>
  `${origin}${pairingPath}?code=${encodeURIComponent(code)}`

export const createPairingResponseSchema = z.object({
  id: z.string(),
  code: z.string(),
  expiresAt: z.string(),
})
export type CreatePairingResponse = z.infer<typeof createPairingResponseSchema>

export const claimPairingBodySchema = z.object({
  code: z.string().trim().min(1).max(32),
  deviceName: deviceNameSchema,
})
export type ClaimPairingBody = z.infer<typeof claimPairingBodySchema>

export const claimPairingResponseSchema = z.object({ token: z.string() })
export type ClaimPairingResponse = z.infer<typeof claimPairingResponseSchema>

export const pickActiveProfile = (me: MeResponse): ProfileDto | undefined =>
  me.activeProfileId === undefined
    ? undefined
    : me.profiles.find((profile) => profile.id === me.activeProfileId)

const isRestricted = (profile: Pick<ProfileDto, 'libraryAccess' | 'maxContentRating'>): boolean =>
  profile.libraryAccess !== 'all' || profile.maxContentRating !== undefined

export const canAdminister = (me: MeResponse): boolean => {
  if (me.account.role !== 'admin') return false
  const profile = pickActiveProfile(me)
  return profile !== undefined && !isRestricted(profile)
}

export const canManageAccount = (me: MeResponse): boolean => {
  const profile = pickActiveProfile(me)
  return profile === undefined ? !me.profiles.some(isRestricted) : !isRestricted(profile)
}
