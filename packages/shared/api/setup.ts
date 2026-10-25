import { z } from 'zod'

import {
  avatarColorSchema,
  passwordSchema,
  profileNameSchema,
  uiLocaleSchema,
  usernameSchema,
} from './auth.ts'

/** Schemas for `/api/v1/setup` (§17.2 Setup, §15 "Premier lancement"). */

/** `GET /setup/status`. `completed` = an account exists; the wizard is then closed. */
export const setupStatusResponseSchema = z.object({
  completed: z.boolean(),
  serverName: z.string().optional(),
})
export type SetupStatusResponse = z.infer<typeof setupStatusResponseSchema>

/** Metadata language (TMDB `language`): `fr-FR`, `en-US`… */
export const metadataLanguageSchema = z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/)

export const serverNameSchema = z.string().trim().min(1).max(64)

/**
 * `POST /setup`: steps 1 and 2 of the wizard (admin account, server name, metadata language).
 * Creates the admin account and its first profile (name defaults to the username, audio and
 * subtitle languages to `uiLocale`), then opens a session (cookie) like `POST /auth/login`.
 * Answers 201 with a `MeResponse`. The first library (step 3) uses `/admin/libraries`.
 */
export const setupBodySchema = z.object({
  username: usernameSchema,
  password: passwordSchema,
  serverName: serverNameSchema.default('projo'),
  metadataLanguage: metadataLanguageSchema.default('fr-FR'),
  uiLocale: uiLocaleSchema.default('fr'),
  profile: z
    .object({
      name: profileNameSchema.optional(),
      avatarColor: avatarColorSchema.optional(),
    })
    .default({}),
})
export type SetupBody = z.input<typeof setupBodySchema>
