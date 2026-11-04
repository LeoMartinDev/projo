import { z } from 'zod'

import {
  avatarColorSchema,
  passwordSchema,
  profileNameSchema,
  uiLocaleSchema,
  usernameSchema,
} from './auth.ts'

export const setupStatusResponseSchema = z.object({
  completed: z.boolean(),
  serverName: z.string().optional(),
})
export type SetupStatusResponse = z.infer<typeof setupStatusResponseSchema>

export const metadataLanguageSchema = z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/)

export const serverNameSchema = z.string().trim().min(1).max(64)

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
