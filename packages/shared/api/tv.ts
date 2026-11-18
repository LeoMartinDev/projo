import { z } from 'zod'

import { isoDateTimeSchema, paginationQuerySchema } from './common.ts'
import { clientCapabilitiesSchema } from './playback.ts'

/** Kinds of TV source (§29.2); slice 1 has `m3u` only, later slices add theirs. */
export const tvSourceKinds = ['m3u'] as const
export const tvSourceKindSchema = z.enum(tvSourceKinds)
export type TvSourceKind = z.infer<typeof tvSourceKindSchema>

/** An absolute `http`/`https` URL with a host (a regular expression: Hermes-safe, no `URL`). */
const isHttpUrl = (value: string): boolean =>
  /^https?:\/\/[^\s/?#@]+(?:@[^\s/?#@]+)?(?:[/?#]\S*)?$/iu.test(value)

export const tvHttpUrlSchema = z
  .string()
  .trim()
  .min(1)
  .max(4096)
  .refine(isHttpUrl, { message: 'must be an http or https URL' })

/** Visible ASCII only: an HTTP header value (a fetch refuses anything else). */
export const tvUserAgentSchema = z
  .string()
  .trim()
  .min(1)
  .max(512)
  .regex(/^[\x20-\x7e]+$/u, { message: 'must be visible ASCII characters' })

export const tvMaxConnectionsSchema = z.number().int().min(1).max(1000)

const sourceNameSchema = z.string().trim().min(1).max(100)

export const m3uSettingsInputSchema = z.object({
  kind: z.literal('m3u'),
  playlistUrl: tvHttpUrlSchema,
  guideUrl: tvHttpUrlSchema.optional(),
  userAgent: tvUserAgentSchema.optional(),
})
export const tvSourceSettingsInputSchema = z.discriminatedUnion('kind', [m3uSettingsInputSchema])
export type TvSourceSettingsInput = z.infer<typeof tvSourceSettingsInputSchema>

export const createTvSourceBodySchema = z.object({
  name: sourceNameSchema,
  settings: tvSourceSettingsInputSchema,
  maxConnections: tvMaxConnectionsSchema.optional(),
})
export type CreateTvSourceBody = z.infer<typeof createTvSourceBodySchema>

/** An absent URL keeps the stored one; `''` removes an optional field (§29.7). */
export const m3uSettingsPatchSchema = z.object({
  kind: z.literal('m3u'),
  playlistUrl: tvHttpUrlSchema.optional(),
  guideUrl: z.union([tvHttpUrlSchema, z.literal('')]).optional(),
  userAgent: z.union([tvUserAgentSchema, z.literal('')]).optional(),
})
export const tvSourceSettingsPatchSchema = z.discriminatedUnion('kind', [m3uSettingsPatchSchema])
export type TvSourceSettingsPatch = z.infer<typeof tvSourceSettingsPatchSchema>

export const updateTvSourceBodySchema = z
  .object({
    name: sourceNameSchema,
    settings: tvSourceSettingsPatchSchema,
    maxConnections: z.union([tvMaxConnectionsSchema, z.literal('')]),
  })
  .partial()
export type UpdateTvSourceBody = z.infer<typeof updateTvSourceBodySchema>

/** Settings as the admin API returns them: every URL masked to `<scheme>://<host>[:port]/…`. */
export const m3uSettingsDtoSchema = z.object({
  kind: z.literal('m3u'),
  playlistUrl: z.string(),
  guideUrl: z.string().optional(),
  userAgent: z.string().optional(),
})
export const tvSourceSettingsDtoSchema = z.discriminatedUnion('kind', [m3uSettingsDtoSchema])
export type TvSourceSettingsDto = z.infer<typeof tvSourceSettingsDtoSchema>

export const tvSourceStates = ['pending', 'refreshing', 'ready', 'error'] as const
export const tvSourceStateSchema = z.enum(tvSourceStates)
export type TvSourceState = z.infer<typeof tvSourceStateSchema>

export const tvSourceErrorDtoSchema = z.object({ code: z.string(), message: z.string() })
export type TvSourceErrorDto = z.infer<typeof tvSourceErrorDtoSchema>

export const adminTvSourceDtoSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: tvSourceKindSchema,
  settings: tvSourceSettingsDtoSchema,
  maxConnections: z.number().int().optional(),
  channelCount: z.number().int(),
  enabledChannelCount: z.number().int(),
  state: tvSourceStateSchema,
  lastRefreshAt: isoDateTimeSchema.optional(),
  lastAttemptAt: isoDateTimeSchema.optional(),
  lastError: tvSourceErrorDtoSchema.optional(),
  failureCount: z.number().int(),
  createdAt: isoDateTimeSchema,
})
export type AdminTvSourceDto = z.infer<typeof adminTvSourceDtoSchema>

export const adminTvSourcesResponseSchema = z.object({ items: z.array(adminTvSourceDtoSchema) })
export type AdminTvSourcesResponse = z.infer<typeof adminTvSourcesResponseSchema>

/** A group of a source; `name` is empty for the unnamed group ("Other channels"). */
export const adminTvGroupDtoSchema = z.object({
  id: z.string(),
  name: z.string(),
  enabled: z.boolean(),
  channelCount: z.number().int(),
  enabledChannelCount: z.number().int(),
})
export type AdminTvGroupDto = z.infer<typeof adminTvGroupDtoSchema>

export const adminTvSourceDetailDtoSchema = adminTvSourceDtoSchema.extend({
  groups: z.array(adminTvGroupDtoSchema),
})
export type AdminTvSourceDetailDto = z.infer<typeof adminTvSourceDetailDtoSchema>

export const adminTvChannelsQuerySchema = paginationQuerySchema.extend({
  q: z.string().trim().max(100).optional(),
  groupId: z.string().min(1).optional(),
})
export type AdminTvChannelsQuery = z.infer<typeof adminTvChannelsQuerySchema>

export const adminTvChannelDtoSchema = z.object({
  id: z.string(),
  name: z.string(),
  number: z.number().int().optional(),
  groupId: z.string(),
  enabled: z.boolean(),
  hasLogo: z.boolean(),
})
export type AdminTvChannelDto = z.infer<typeof adminTvChannelDtoSchema>

export const adminTvChannelsPageSchema = z.object({
  items: z.array(adminTvChannelDtoSchema),
  nextCursor: z.string().optional(),
  total: z.number().int(),
})
export type AdminTvChannelsPage = z.infer<typeof adminTvChannelsPageSchema>

export const setTvEnabledBodySchema = z.object({ enabled: z.boolean() })
export type SetTvEnabledBody = z.infer<typeof setTvEnabledBodySchema>

/** A programme of the guide (§29.3): now or next of a channel. */
export const tvProgrammeDtoSchema = z.object({
  title: z.string(),
  startAt: isoDateTimeSchema,
  endAt: isoDateTimeSchema,
})
export type TvProgrammeDto = z.infer<typeof tvProgrammeDtoSchema>

/** A channel as a viewer sees it (§29.7); `logoUrl` is a server path (media key accepted). */
export const tvChannelDtoSchema = z.object({
  id: z.string(),
  name: z.string(),
  number: z.number().int().optional(),
  groupId: z.string(),
  logoUrl: z.string().optional(),
  favorite: z.boolean().optional(),
  now: tvProgrammeDtoSchema.optional(),
  next: tvProgrammeDtoSchema.optional(),
})
export type TvChannelDto = z.infer<typeof tvChannelDtoSchema>

/** A group of the listed channels; `name` is empty for an unnamed group ("Other channels"). */
export const tvGroupDtoSchema = z.object({ id: z.string(), name: z.string() })
export type TvGroupDto = z.infer<typeof tvGroupDtoSchema>

export const tvChannelsResponseSchema = z.object({
  groups: z.array(tvGroupDtoSchema),
  items: z.array(tvChannelDtoSchema),
  /** The profile's favourite channels, in the order they were added (absent before the guide). */
  favorites: z.array(z.string()).optional(),
})
export type TvChannelsResponse = z.infer<typeof tvChannelsResponseSchema>

/** Now and next of a channel (§29.7): what the page and the player read every minute. */
export const tvGuideEntryDtoSchema = z.object({
  channelId: z.string(),
  now: tvProgrammeDtoSchema.optional(),
  next: tvProgrammeDtoSchema.optional(),
})
export type TvGuideEntryDto = z.infer<typeof tvGuideEntryDtoSchema>

export const tvGuideResponseSchema = z.object({ items: z.array(tvGuideEntryDtoSchema) })
export type TvGuideResponse = z.infer<typeof tvGuideResponseSchema>

/** What a live session plays (§29.4): the relayed stream, or its H.264 transcode (later). */
export const tvRenditions = ['copy', 'compat'] as const
export const tvRenditionSchema = z.enum(tvRenditions)
export type TvRendition = z.infer<typeof tvRenditionSchema>

export const createTvSessionBodySchema = z.object({ capabilities: clientCapabilitiesSchema })
export type CreateTvSessionBody = z.infer<typeof createTvSessionBodySchema>

/** `streamUrl` is the session's capability URL of its live playlist (§20). */
export const tvSessionDtoSchema = z.object({
  sessionId: z.string(),
  streamUrl: z.string(),
  rendition: tvRenditionSchema,
})
export type TvSessionDto = z.infer<typeof tvSessionDtoSchema>

/** A live session in the admin's active sessions (§29.4). */
export const adminTvSessionDtoSchema = z.object({
  id: z.string(),
  account: z.object({ id: z.string(), name: z.string() }),
  profile: z.object({ id: z.string(), name: z.string(), color: z.string() }),
  channel: z.object({ id: z.string(), name: z.string(), number: z.number().int().optional() }),
  rendition: tvRenditionSchema,
  device: z.string().optional(),
  startedAt: isoDateTimeSchema,
  lastHeartbeatAt: isoDateTimeSchema,
})
export type AdminTvSessionDto = z.infer<typeof adminTvSessionDtoSchema>

export const adminTvSessionsResponseSchema = z.object({ items: z.array(adminTvSessionDtoSchema) })
export type AdminTvSessionsResponse = z.infer<typeof adminTvSessionsResponseSchema>
