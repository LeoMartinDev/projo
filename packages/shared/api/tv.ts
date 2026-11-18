import { z } from 'zod'

import { isoDateTimeSchema, paginationQuerySchema } from './common.ts'
import { clientCapabilitiesSchema } from './playback.ts'

/** Kinds of TV source (§29.2). */
export const tvSourceKinds = ['m3u', 'xtream', 'freebox'] as const
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

/** A Freebox's own address on its network (§29.2). */
export const DEFAULT_FREEBOX_ADDRESS = 'http://mafreebox.freebox.fr'

/**
 * `http`, a host and an optional port; nothing else (a trailing `/` is accepted). Never `https`:
 * the box's certificate chains to Freebox's own authority, which the server does not trust.
 */
export const freeboxAddressSchema = z
  .string()
  .trim()
  .min(1)
  .max(512)
  .regex(/^http:\/\/[^\s/?#@\\]+\/?$/iu, { message: 'must be an http address' })

/**
 * An Xtream Codes panel's root (§29.2): `http` or `https`, a host and an optional port, nothing
 * else (a trailing `/` is accepted).
 */
export const xtreamServerUrlSchema = z
  .string()
  .trim()
  .min(1)
  .max(512)
  .regex(/^https?:\/\/[^\s/?#@\\]+\/?$/iu, { message: 'must be an http or https address' })

/** Neither whitespace nor a control character. */
const isPrintableWord = (value: string): boolean => {
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0
    if (code <= 0x20 || code === 0x7f || /\s/u.test(char)) return false
  }
  return true
}

/** An Xtream username or password: sent percent-encoded in every URL, never trimmed. */
export const xtreamCredentialSchema = z
  .string()
  .min(1)
  .max(200)
  .refine(isPrintableWord, { message: 'must hold no whitespace nor control character' })

export const tvMaxConnectionsSchema = z.number().int().min(1).max(1000)

const sourceNameSchema = z.string().trim().min(1).max(100)

export const m3uSettingsInputSchema = z.object({
  kind: z.literal('m3u'),
  playlistUrl: tvHttpUrlSchema,
  guideUrl: tvHttpUrlSchema.optional(),
  userAgent: tvUserAgentSchema.optional(),
})
export const xtreamSettingsInputSchema = z.object({
  kind: z.literal('xtream'),
  serverUrl: xtreamServerUrlSchema,
  username: xtreamCredentialSchema,
  password: xtreamCredentialSchema,
})
export const freeboxSettingsInputSchema = z.object({
  kind: z.literal('freebox'),
  address: freeboxAddressSchema,
})
export const tvSourceSettingsInputSchema = z.discriminatedUnion('kind', [
  m3uSettingsInputSchema,
  xtreamSettingsInputSchema,
  freeboxSettingsInputSchema,
])
export type TvSourceSettingsInput = z.infer<typeof tvSourceSettingsInputSchema>

/**
 * Whether a source's connection limit is its provider account's (an `xtream` source's, read by
 * each refresh), never the admin's (§29.2): the server refuses one (`tv/source_invalid`), the
 * admin form shows it read-only.
 */
export const limitFromAccount = (kind: TvSourceKind): boolean => kind === 'xtream'

/** `maxConnections` on an `xtream` source is refused by the server (`tv/source_invalid`). */
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
/** An absent field keeps the stored value; an empty one is refused (never wiped by accident). */
export const xtreamSettingsPatchSchema = z.object({
  kind: z.literal('xtream'),
  serverUrl: xtreamServerUrlSchema.optional(),
  username: xtreamCredentialSchema.optional(),
  password: xtreamCredentialSchema.optional(),
})
export const freeboxSettingsPatchSchema = z.object({
  kind: z.literal('freebox'),
  address: freeboxAddressSchema.optional(),
})
export const tvSourceSettingsPatchSchema = z.discriminatedUnion('kind', [
  m3uSettingsPatchSchema,
  xtreamSettingsPatchSchema,
  freeboxSettingsPatchSchema,
])
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
/** The panel's origin; the username and password are never returned (§29.7). */
export const xtreamSettingsDtoSchema = z.object({
  kind: z.literal('xtream'),
  serverUrl: z.string(),
})
/** A Freebox's address holds no secret: returned as it is. */
export const freeboxSettingsDtoSchema = z.object({
  kind: z.literal('freebox'),
  address: z.string(),
})
export const tvSourceSettingsDtoSchema = z.discriminatedUnion('kind', [
  m3uSettingsDtoSchema,
  xtreamSettingsDtoSchema,
  freeboxSettingsDtoSchema,
])
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

/**
 * The guide channel a channel's programmes come from (§29.3): the admin's choice (`manual`), else
 * the one the last read matched; `name` its first display name when the last read listed it.
 */
export const adminTvGuideMatchDtoSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  manual: z.boolean(),
})
export type AdminTvGuideMatchDto = z.infer<typeof adminTvGuideMatchDtoSchema>

export const adminTvChannelDtoSchema = z.object({
  id: z.string(),
  name: z.string(),
  number: z.number().int().optional(),
  groupId: z.string(),
  enabled: z.boolean(),
  hasLogo: z.boolean(),
  guideChannel: adminTvGuideMatchDtoSchema.optional(),
  /** Whether the last guide read matched a guide channel to it; absent before any read. */
  guideMatched: z.boolean().optional(),
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

/** A guide channel id (XMLTV `<channel id>`), or `''` for "Automatic" (§29.7). */
export const tvGuideChannelChoiceSchema = z.union([
  z.literal(''),
  z.string().trim().min(1).max(200),
])

/** `PATCH /admin/tv/channels/:id` (§29.7): at least one field. */
export const updateTvChannelBodySchema = z
  .object({ enabled: z.boolean(), guideChannel: tvGuideChannelChoiceSchema })
  .partial()
  .refine((body) => body.enabled !== undefined || body.guideChannel !== undefined, {
    message: 'nothing to change',
  })
export type UpdateTvChannelBody = z.infer<typeof updateTvChannelBodySchema>

export const adminTvGuideChannelsQuerySchema = paginationQuerySchema.extend({
  q: z.string().trim().max(100).optional(),
})
export type AdminTvGuideChannelsQuery = z.infer<typeof adminTvGuideChannelsQuerySchema>

/** A channel of a source's guide, as its last read listed it (§29.3). */
export const adminTvGuideChannelDtoSchema = z.object({
  id: z.string(),
  names: z.array(z.string()),
})
export type AdminTvGuideChannelDto = z.infer<typeof adminTvGuideChannelDtoSchema>

export const adminTvGuideChannelsPageSchema = z.object({
  items: z.array(adminTvGuideChannelDtoSchema),
  nextCursor: z.string().optional(),
  total: z.number().int(),
})
export type AdminTvGuideChannelsPage = z.infer<typeof adminTvGuideChannelsPageSchema>

/**
 * Kinds of programme (§29.3): projo's own ids, like genres; labels `programmeKinds.<id>` in the
 * locales. A provider's category text never stands in for one.
 */
export const tvProgrammeKinds = [
  'news',
  'sport',
  'movie',
  'series',
  'kids',
  'documentary',
  'entertainment',
  'music',
  'other',
] as const
export const tvProgrammeKindSchema = z.enum(tvProgrammeKinds)
export type TvProgrammeKind = z.infer<typeof tvProgrammeKindSchema>

/** A programme's episode (§29.3): numbers from 1; `label` the on-screen text, only without numbers. */
export const tvEpisodeDtoSchema = z.object({
  season: z.number().int().optional(),
  episode: z.number().int().optional(),
  label: z.string().optional(),
})
export type TvEpisodeDto = z.infer<typeof tvEpisodeDtoSchema>

/**
 * A programme of the guide (§29.3): now or next of a channel. `id`, `kind` and the details are
 * absent from older servers; `imageUrl` is a server path (media key accepted) once its image is
 * stored.
 */
export const tvProgrammeDtoSchema = z.object({
  id: z.string().optional(),
  title: z.string(),
  subtitle: z.string().optional(),
  episode: tvEpisodeDtoSchema.optional(),
  kind: tvProgrammeKindSchema.optional(),
  imageUrl: z.string().optional(),
  startAt: isoDateTimeSchema,
  endAt: isoDateTimeSchema,
})
export type TvProgrammeDto = z.infer<typeof tvProgrammeDtoSchema>

/**
 * A channel as a viewer sees it (§29.7); `logoUrl` is a server path (media key accepted); `kind`
 * the channel's own kind (§29.3), absent from older servers.
 */
export const tvChannelDtoSchema = z.object({
  id: z.string(),
  name: z.string(),
  number: z.number().int().optional(),
  groupId: z.string(),
  logoUrl: z.string().optional(),
  kind: tvProgrammeKindSchema.optional(),
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

/** At most this many channels per `GET /tv/schedule` (§29.7). */
export const TV_SCHEDULE_MAX_CHANNELS = 100
/** At most this long a range per `GET /tv/schedule` (§29.7). */
export const TV_SCHEDULE_MAX_RANGE_MS = 24 * 60 * 60_000

/**
 * `GET /tv/schedule` (§29.7): the guide grid's read, the programmes overlapping `[from, to)` of
 * the channels asked (comma-separated ids, each kept once), the range at most 24 hours.
 */
export const tvScheduleQuerySchema = z
  .object({
    from: isoDateTimeSchema,
    to: isoDateTimeSchema,
    channels: z
      .string()
      .transform((value) => [...new Set(value.split(',').filter((id) => id !== ''))])
      .pipe(z.array(z.string().max(64)).min(1).max(TV_SCHEDULE_MAX_CHANNELS)),
  })
  .refine(
    ({ from, to }) => {
      const span = Date.parse(to) - Date.parse(from)
      return span > 0 && span <= TV_SCHEDULE_MAX_RANGE_MS
    },
    { message: 'from must be before to, at most 24 hours apart', path: ['to'] },
  )
export type TvScheduleQuery = z.input<typeof tvScheduleQuerySchema>

/** A programme of the guide grid (§29.7): no subtitle, description nor image (its detail has them). */
export const tvScheduleProgrammeDtoSchema = z.object({
  id: z.string(),
  title: z.string(),
  startAt: isoDateTimeSchema,
  endAt: isoDateTimeSchema,
  kind: tvProgrammeKindSchema,
  episode: tvEpisodeDtoSchema.optional(),
})
export type TvScheduleProgrammeDto = z.infer<typeof tvScheduleProgrammeDtoSchema>

export const tvScheduleResponseSchema = z.object({
  items: z.array(
    z.object({ channelId: z.string(), programmes: z.array(tvScheduleProgrammeDtoSchema) }),
  ),
})
export type TvScheduleResponse = z.infer<typeof tvScheduleResponseSchema>

/** `GET /tv/programmes/:id` (§29.7): a programme in full, with the one that follows it. */
export const tvProgrammeDetailDtoSchema = z.object({
  id: z.string(),
  channelId: z.string(),
  title: z.string(),
  subtitle: z.string().optional(),
  description: z.string().optional(),
  episode: tvEpisodeDtoSchema.optional(),
  kind: tvProgrammeKindSchema,
  categories: z.array(z.string()),
  startAt: isoDateTimeSchema,
  endAt: isoDateTimeSchema,
  imageUrl: z.string().optional(),
  next: tvProgrammeDtoSchema.optional(),
})
export type TvProgrammeDetailDto = z.infer<typeof tvProgrammeDetailDtoSchema>

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
