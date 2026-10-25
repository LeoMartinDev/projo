import { z } from 'zod'

import { profileDtoSchema } from './profiles.ts'

/** Schemas for `/api/v1/auth` and `/api/v1/invitations` (§17.2 Auth). */

export const accountRoleSchema = z.enum(['admin', 'user'])
export type AccountRole = z.infer<typeof accountRoleSchema>

export const sessionKindSchema = z.enum(['cookie', 'bearer'])
export type SessionKind = z.infer<typeof sessionKindSchema>

/** Name of the session cookie (§14). */
export const sessionCookieName = 'projo_session'
/** Header carrying the active profile (§17.1). */
export const profileIdHeader = 'X-Profile-Id'

// ── Credentials (§14) ────────────────────────────────────────────────────────

/** 3 to 32 characters: letters, digits, `.`, `_`, `-`. Unique case-insensitively. */
export const usernameSchema = z
  .string()
  .min(3)
  .max(32)
  .regex(/^[A-Za-z0-9._-]+$/)
/** 12 characters minimum. */
export const passwordSchema = z.string().min(12).max(256)

export const deviceNameSchema = z.string().trim().min(1).max(64)

// ── Profiles: defined in `profiles.ts`, re-exported for existing importers ──

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

// ── Account and session ──────────────────────────────────────────────────────

export const accountDtoSchema = z.object({
  id: z.string(),
  username: z.string(),
  role: accountRoleSchema,
})
export type AccountDto = z.infer<typeof accountDtoSchema>

/**
 * `GET /auth/me`, and the body of `POST /auth/login`, `POST /setup`,
 * `POST /invitations/:token/accept` and `POST /profiles/:id/select`. `activeProfileId` is the
 * profile resolved for this request (`X-Profile-Id`, else the only profile, else the last one
 * used by this session, §13.6); absent when the client must choose.
 * `needsProfileSelection`: "Who's watching?" must be shown (several profiles, none restored for
 * this session, or `X-Profile-Id` names a PIN-protected profile this session has not unlocked).
 */
export const meResponseSchema = z.object({
  account: accountDtoSchema,
  profiles: z.array(profileDtoSchema),
  activeProfileId: z.string().optional(),
  needsProfileSelection: z.boolean(),
})
export type MeResponse = z.infer<typeof meResponseSchema>

/** `POST /auth/login`. Sets the `projo_session` cookie. */
export const loginBodySchema = z.object({
  username: z.string().min(1).max(64),
  password: z.string().min(1).max(256),
  deviceName: deviceNameSchema.optional(),
})
export type LoginBody = z.infer<typeof loginBodySchema>

// ── Devices (sessions and bearer tokens) ─────────────────────────────────────

export const sessionDtoSchema = z.object({
  id: z.string(),
  kind: sessionKindSchema,
  deviceName: z.string(),
  userAgent: z.string(),
  createdAt: z.string(),
  lastSeenAt: z.string(),
  expiresAt: z.string(),
  /** The session this request is authenticated with. */
  current: z.boolean(),
})
export type SessionDto = z.infer<typeof sessionDtoSchema>

/** `GET /auth/sessions`: active sessions of the account, most recently seen first. */
export const sessionsResponseSchema = z.object({ items: z.array(sessionDtoSchema) })
export type SessionsResponse = z.infer<typeof sessionsResponseSchema>

/** `POST /auth/tokens`: bearer token for a device (mobile app). */
export const createTokenBodySchema = z.object({ deviceName: deviceNameSchema })
export type CreateTokenBody = z.infer<typeof createTokenBodySchema>

/** The token is shown once: only its hash is stored. */
export const createTokenResponseSchema = z.object({
  token: z.string(),
  session: sessionDtoSchema,
})
export type CreateTokenResponse = z.infer<typeof createTokenResponseSchema>

/**
 * `POST /auth/password` (204): changes the password of the signed-in account and revokes its
 * other sessions and tokens. 403 `account/wrong_password`, 429 `auth/rate_limited`.
 */
export const changePasswordBodySchema = z.object({
  currentPassword: z.string().min(1).max(256),
  newPassword: passwordSchema,
})
export type ChangePasswordBody = z.infer<typeof changePasswordBodySchema>
