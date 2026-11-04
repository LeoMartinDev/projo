import { z } from 'zod'

import { segmentSettingsDtoSchema, updateSegmentSettingsBodySchema } from './segments.ts'

export const metadataLanguageSchema = z
  .string()
  .regex(/^[a-z]{2,3}(-[A-Z]{2})?$/u, { message: 'expected a language tag such as fr-FR' })

export const playbackSettingsDtoSchema = z.object({
  maxConcurrentTranscodes: z.number().int().min(1).max(16),
  audioDownmix: z.enum(['stereo', 'keep']),
  burnInEnabled: z.boolean(),
  transcodeCacheMaxGb: z.number().int().min(1).max(10_000),
  trickplayEnabled: z.boolean(),
  hwAccel: z.enum(['off', 'vaapi']),
})
export type PlaybackSettingsDto = z.infer<typeof playbackSettingsDtoSchema>

export const serverSettingsDtoSchema = z.object({
  name: z.string(),
  port: z.number().int(),
  trustProxy: z.boolean(),
  dataDir: z.string(),
})
export type ServerSettingsDto = z.infer<typeof serverSettingsDtoSchema>

export const serverNameSchema = z.string().trim().min(1).max(64)

export const adminSettingsDtoSchema = z.object({
  playback: playbackSettingsDtoSchema,
  metadata: z.object({
    language: metadataLanguageSchema,
    tmdbApiKey: z.object({
      configured: z.boolean(),
      state: z.enum(['missing', 'valid', 'rejected']),
      last4: z.string().optional(),
    }),
  }),
  segments: segmentSettingsDtoSchema,
  server: serverSettingsDtoSchema,
})
export type AdminSettingsDto = z.infer<typeof adminSettingsDtoSchema>

export const updateAdminSettingsBodySchema = z
  .object({
    playback: playbackSettingsDtoSchema.partial(),
    metadata: z
      .object({
        language: metadataLanguageSchema,
        tmdbApiKey: z.union([z.string().trim().min(16).max(1024), z.literal('')]),
      })
      .partial(),
    segments: updateSegmentSettingsBodySchema,
    server: z.object({ name: serverNameSchema }).partial(),
  })
  .partial()
export type UpdateAdminSettingsBody = z.infer<typeof updateAdminSettingsBodySchema>
