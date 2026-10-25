import { z } from 'zod'

/** Schemas for `/api/v1/profiles` (§17.2 Profils, §13.6, §14). */

export const avatarColorSchema = z.enum(['slate', 'blue', 'honey', 'sage', 'terracotta', 'violet'])
export type AvatarColor = z.infer<typeof avatarColorSchema>

export const uiLocaleSchema = z.enum(['fr', 'en'])
export type UiLocale = z.infer<typeof uiLocaleSchema>

export const subtitleModeSchema = z.enum(['never', 'always', 'when_audio_differs', 'forced_only'])
export type SubtitleMode = z.infer<typeof subtitleModeSchema>

export const libraryAccessSchema = z.enum(['all', 'selected'])
export type LibraryAccess = z.infer<typeof libraryAccessSchema>

export const profileNameSchema = z.string().trim().min(1).max(32)

/** Optional 4-digit PIN (§14), stored as argon2id. */
export const pinSchema = z.string().regex(/^\d{4}$/)

/** ISO 639-1 (`fr`) or 639-2 (`fre`) language of the audio / subtitle preferences (§11.1). */
export const languageCodeSchema = z.string().regex(/^[a-z]{2,3}$/)

/**
 * Maximum rating of a profile (§14): an age tier, the same for every rating country. Labels (FR):
 * `0` Tous publics, `10`, `12`, `16`, `18` ans et plus. Absent = no limit. Each country's ratings
 * map onto these tiers (`core/profile/content-rating.ts`).
 */
export const contentRatingTiers = ['0', '10', '12', '16', '18'] as const
export const contentRatingTierSchema = z.enum(contentRatingTiers)
export type ContentRatingTier = z.infer<typeof contentRatingTierSchema>

/** A profile as exposed to its account (and to admins). Never carries the PIN hash. */
export const profileDtoSchema = z.object({
  id: z.string(),
  name: z.string(),
  avatarColor: avatarColorSchema,
  hasPin: z.boolean(),
  uiLocale: uiLocaleSchema,
  audioLanguage: z.string(),
  subtitleLanguage: z.string(),
  subtitleMode: subtitleModeSchema,
  animeOriginalAudio: z.boolean(),
  autoplayNext: z.boolean(),
  autoSkipIntro: z.boolean(),
  autoSkipCredits: z.boolean(),
  libraryAccess: libraryAccessSchema,
  /** Libraries the profile sees when `libraryAccess = selected` (empty for `all`). */
  libraryIds: z.array(z.string()),
  maxContentRating: contentRatingTierSchema.optional(),
  createdAt: z.string(),
})
export type ProfileDto = z.infer<typeof profileDtoSchema>

/** `GET /profiles`: the account's profiles, oldest first. */
export const profilesResponseSchema = z.object({ items: z.array(profileDtoSchema) })
export type ProfilesResponse = z.infer<typeof profilesResponseSchema>

/**
 * `POST /profiles` (201 `ProfileDto`, 409 `profile/limit_reached` at 5). Defaults: the first
 * colour not used by the account, `uiLocale` `fr`, audio and subtitle languages = `uiLocale`.
 * Library access and maximum rating: an admin acting from an unrestricted profile may set
 * anything; otherwise they default to, and may only narrow, the restrictions of the active
 * profile (or of the account's profiles together when none is active) — 403 `profile/admin_only`.
 */
export const createProfileBodySchema = z.object({
  name: profileNameSchema,
  avatarColor: avatarColorSchema.optional(),
  pin: pinSchema.optional(),
  uiLocale: uiLocaleSchema.optional(),
  audioLanguage: languageCodeSchema.optional(),
  subtitleLanguage: languageCodeSchema.optional(),
  subtitleMode: subtitleModeSchema.optional(),
  animeOriginalAudio: z.boolean().optional(),
  autoplayNext: z.boolean().optional(),
  autoSkipIntro: z.boolean().optional(),
  autoSkipCredits: z.boolean().optional(),
  libraryAccess: libraryAccessSchema.optional(),
  libraryIds: z.array(z.string().min(1)).max(500).optional(),
  maxContentRating: contentRatingTierSchema.optional(),
})
export type CreateProfileBody = z.infer<typeof createProfileBodySchema>

/**
 * `PATCH /profiles/:id` (200 `ProfileDto`). Absent key = unchanged. `pin: ""` removes the PIN,
 * `maxContentRating: ""` removes the limit. `libraryIds` applies when the resulting access is
 * `selected`. Own profiles for everyone; any profile for an admin.
 * - Widening the library access or the maximum rating needs an admin acting from an unrestricted
 *   profile (403 `profile/admin_only`); narrowing is open to everyone.
 * - A PIN-protected profile that is not the active one needs `currentPin` (403
 *   `profile/pin_required`, `profile/invalid_pin`, 429 `profile/rate_limited`), except for an admin
 *   editing another account's profile.
 */
export const updateProfileBodySchema = z.object({
  name: profileNameSchema.optional(),
  avatarColor: avatarColorSchema.optional(),
  pin: z.union([pinSchema, z.literal('')]).optional(),
  currentPin: pinSchema.optional(),
  uiLocale: uiLocaleSchema.optional(),
  audioLanguage: languageCodeSchema.optional(),
  subtitleLanguage: languageCodeSchema.optional(),
  subtitleMode: subtitleModeSchema.optional(),
  animeOriginalAudio: z.boolean().optional(),
  autoplayNext: z.boolean().optional(),
  autoSkipIntro: z.boolean().optional(),
  autoSkipCredits: z.boolean().optional(),
  libraryAccess: libraryAccessSchema.optional(),
  libraryIds: z.array(z.string().min(1)).max(500).optional(),
  maxContentRating: z.union([contentRatingTierSchema, z.literal('')]).optional(),
})
export type UpdateProfileBody = z.infer<typeof updateProfileBodySchema>

/**
 * `DELETE /profiles/:id` (204; body optional). The progress of the profile is lost. 409
 * `profile/last_profile` for the only profile of an account; `currentPin` as for `PATCH`.
 */
export const deleteProfileBodySchema = z.object({ currentPin: pinSchema.optional() })
export type DeleteProfileBody = z.infer<typeof deleteProfileBodySchema>

/**
 * `POST /profiles/:id/verify-pin` (204, 403 `profile/invalid_pin`, 429 `profile/rate_limited`:
 * 5 checks per minute per profile, shared with `select`, `PATCH` and `DELETE`). Changes nothing.
 */
export const verifyPinBodySchema = z.object({ pin: pinSchema })
export type VerifyPinBody = z.infer<typeof verifyPinBodySchema>

/**
 * `POST /profiles/:id/select` (200 `MeResponse`): makes the profile the active one of this
 * session (`sessions.last_profile_id`, restored on the next visit). `pin` is required when the
 * profile has one (403 `profile/pin_required`).
 */
export const selectProfileBodySchema = z.object({ pin: pinSchema.optional() })
export type SelectProfileBody = z.infer<typeof selectProfileBodySchema>
