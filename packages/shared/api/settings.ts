import { z } from 'zod'

import { segmentSettingsDtoSchema, updateSegmentSettingsBodySchema } from './segments.ts'

/**
 * `GET/PATCH /admin/settings` (§15): sections "Playback", "Intros and credits", "Metadata" and "Server".
 * "Updates" has its own routes (`api/updates`).
 */

export const metadataLanguageSchema = z
  .string()
  .regex(/^[a-z]{2,3}(-[A-Z]{2})?$/u, { message: 'expected a language tag such as fr-FR' })

/**
 * §15 "Playback" (§10, defaults of §24).
 * - `maxConcurrentTranscodes`: `hls_transcode` sessions at once (beyond: 503
 *   `playback/transcode_limit_reached`);
 * - `audioDownmix`: `stereo` downmixes multichannel audio in remux and transcode, `keep` keeps it;
 * - `burnInEnabled`: bitmap subtitles (PGS, VobSub) burnt into a transcode; off: not offered;
 * - `transcodeCacheMaxGb`: LRU size of `cache/transcode/`;
 * - `trickplayEnabled`: timeline thumbnails, server-wide switch (each library also has its own);
 * - `hwAccel`: `vaapi` transcodes on the GPU's render node, with a software fallback (§10.3).
 */
export const playbackSettingsDtoSchema = z.object({
  maxConcurrentTranscodes: z.number().int().min(1).max(16),
  audioDownmix: z.enum(['stereo', 'keep']),
  burnInEnabled: z.boolean(),
  transcodeCacheMaxGb: z.number().int().min(1).max(10_000),
  trickplayEnabled: z.boolean(),
  hwAccel: z.enum(['off', 'vaapi']),
})
export type PlaybackSettingsDto = z.infer<typeof playbackSettingsDtoSchema>

/**
 * §15 "Server": the name is editable; port, `TRUST_PROXY` and the data folder are environment
 * variables (§5.4), shown read-only. Space used: `GET /admin/stats` (`storage`); "Exporter la
 * base": `POST /admin/db/export`.
 */
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
    /** Server-wide metadata language (§9.1), overridable per library. */
    language: metadataLanguageSchema,
    /**
     * The key is never sent back: only whether one is set and its last 4 characters. `state`:
     * `rejected` when TMDB answered 401 to it since it was validated (revoked key).
     */
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

/**
 * Partial update, section by section. `tmdbApiKey`: validated against TMDB before it is stored (422
 * `metadata/tmdb_key_invalid`); `""` removes it. Setting a key relaunches the matching of the
 * unidentified sources. Playback values apply to the next session or job, no restart.
 */
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
