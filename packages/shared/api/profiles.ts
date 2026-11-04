import { z } from 'zod'

export const avatarColorSchema = z.enum(['slate', 'blue', 'honey', 'sage', 'terracotta', 'violet'])
export type AvatarColor = z.infer<typeof avatarColorSchema>

export const uiLocaleSchema = z.enum(['fr', 'en'])
export type UiLocale = z.infer<typeof uiLocaleSchema>

export const subtitleModeSchema = z.enum(['never', 'always', 'when_audio_differs', 'forced_only'])
export type SubtitleMode = z.infer<typeof subtitleModeSchema>

export const libraryAccessSchema = z.enum(['all', 'selected'])
export type LibraryAccess = z.infer<typeof libraryAccessSchema>

export const profileNameSchema = z.string().trim().min(1).max(32)

export const pinSchema = z.string().regex(/^\d{4}$/)

export const languageCodeSchema = z.string().regex(/^[a-z]{2,3}$/)

export const contentRatingTiers = ['0', '10', '12', '16', '18'] as const
export const contentRatingTierSchema = z.enum(contentRatingTiers)
export type ContentRatingTier = z.infer<typeof contentRatingTierSchema>

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
  libraryIds: z.array(z.string()),
  maxContentRating: contentRatingTierSchema.optional(),
  createdAt: z.string(),
})
export type ProfileDto = z.infer<typeof profileDtoSchema>

export const profilesResponseSchema = z.object({ items: z.array(profileDtoSchema) })
export type ProfilesResponse = z.infer<typeof profilesResponseSchema>

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

export const deleteProfileBodySchema = z.object({ currentPin: pinSchema.optional() })
export type DeleteProfileBody = z.infer<typeof deleteProfileBodySchema>

export const verifyPinBodySchema = z.object({ pin: pinSchema })
export type VerifyPinBody = z.infer<typeof verifyPinBodySchema>

export const selectProfileBodySchema = z.object({ pin: pinSchema.optional() })
export type SelectProfileBody = z.infer<typeof selectProfileBodySchema>
