import type { TvUpstream } from '../../../core/tv/channel.ts'
import type { TvProviderChannel } from '../../../core/tv/provider.ts'
import type { XtreamSettings } from '../../../core/tv/source.ts'
import {
  type XtreamAccount,
  type XtreamCategory,
  xtreamCategorySchema,
  type XtreamFailure,
  type XtreamStream,
  xtreamStreamSchema,
} from './xtream-api.ts'

/** What the relay reads a channel as (§29.2): MPEG-TS, else the provider's HLS. */
export type XtreamOutputFormat = 'ts' | 'm3u8'

/** The panel's root: its origin, whatever trailing `/` the admin typed. */
export const xtreamOriginOf = (serverUrl: string): string | undefined =>
  URL.canParse(serverUrl) ? new URL(serverUrl).origin : undefined

const encoded = (value: string): string => encodeURIComponent(value)

/** `player_api.php` of the account, with `action` when given. */
export const xtreamApiUrl = (
  origin: string,
  { username, password }: Pick<XtreamSettings, 'username' | 'password'>,
  action?: string,
): string =>
  `${origin}/player_api.php?username=${encoded(username)}&password=${encoded(password)}${
    action === undefined ? '' : `&action=${action}`
  }`

/** The account's XMLTV guide (§29.3). */
export const xtreamGuideUrl = (
  origin: string,
  { username, password }: Pick<XtreamSettings, 'username' | 'password'>,
): string => `${origin}/xmltv.php?username=${encoded(username)}&password=${encoded(password)}`

/**
 * Why the account cannot be used (§29.2): `auth` other than 1, a status other than `Active`
 * (`expired`, `banned`, `disabled`, else `inactive`), an `exp_date` in the past (`expired`).
 */
export const accountRefusalOf = (account: XtreamAccount, now: Date): string | undefined => {
  if (account.auth !== 1) return 'auth_failed'
  const status = account.status?.toLowerCase()
  if (status !== undefined && status !== 'active')
    return status === 'expired' || status === 'banned' || status === 'disabled'
      ? status
      : 'inactive'
  if (account.expiresAt !== undefined && account.expiresAt > 0) {
    if (account.expiresAt * 1000 <= now.getTime()) return 'expired'
  }
  return undefined
}

/** `ts` when allowed (or nothing is said), else `m3u8`; neither (`rtmp` only): `undefined`. */
export const outputFormatOf = (account: XtreamAccount): XtreamOutputFormat | undefined => {
  const formats = account.outputFormats
  if (formats === undefined || formats.length === 0 || formats.includes('ts')) return 'ts'
  return formats.includes('m3u8') ? 'm3u8' : undefined
}

/** The account's connection limit: a positive integer, else none. */
export const accountLimitOf = (account: XtreamAccount): { maxConnections?: number } =>
  account.maxConnections !== undefined && account.maxConnections > 0
    ? { maxConnections: account.maxConnections }
    : {}

/** Entries that are live channels; `radio_streams`, `movie`, `series`… are not (§29.2). */
const liveStreamTypes = new Set(['live', 'created_live'])

const collapse = (text: string): string => text.replace(/\s+/gu, ' ').trim()

const isHttpUrl = (value: string): boolean => {
  if (!URL.canParse(value)) return false
  const { protocol } = new URL(value)
  return protocol === 'http:' || protocol === 'https:'
}

const storedPathPattern = /^live\/(\d{1,15})\.(ts|m3u8)$/u

/** The stored upstream of a stream: its path without credentials (§29.2). */
const storedUpstream = (streamId: number, format: XtreamOutputFormat): TvUpstream => ({
  url: `live/${streamId}.${format}`,
})

/**
 * The stream URL of a stored upstream, built from the current settings (§29.2):
 * `<server>/live/<username>/<password>/<id>.<ext>`, the credentials named as its secrets so the
 * relay's logs never show them (`maskUrls` masks their percent-encoded forms too). `undefined`
 * when it is not an Xtream stream path: the stream cannot be opened.
 */
export const xtreamStreamUrlOf = (
  settings: XtreamSettings,
  upstream: TvUpstream,
): TvUpstream | undefined => {
  const match = storedPathPattern.exec(upstream.url) ?? undefined
  const origin = xtreamOriginOf(settings.serverUrl)
  if (match === undefined || origin === undefined) return undefined
  const [, streamId, format] = match
  const { username, password } = settings
  return {
    url: `${origin}/live/${encoded(username)}/${encoded(password)}/${streamId}.${format}`,
    secrets: [...new Set([username, password])],
  }
}

/** The categories of an answer, entries of another shape skipped. */
export const xtreamCategoriesOf = (entries: unknown[]): XtreamCategory[] =>
  entries.flatMap((entry) => {
    const parsed = xtreamCategorySchema.safeParse(entry)
    return parsed.success ? [parsed.data] : []
  })

/** The streams of an answer, entries of another shape skipped. */
export const xtreamStreamsOf = (entries: unknown[]): XtreamStream[] =>
  entries.flatMap((entry) => {
    const parsed = xtreamStreamSchema.safeParse(entry)
    return parsed.success ? [parsed.data] : []
  })

/**
 * The live channels of a panel (§29.2): live entries with a positive stream id and a name, keyed
 * by stream id (the first of a duplicate wins), grouped by category, ordered by the categories'
 * order, then `num`, then the listing's.
 */
export const xtreamChannelsOf = ({
  categories,
  streams,
  format,
}: {
  categories: XtreamCategory[]
  streams: XtreamStream[]
  format: XtreamOutputFormat
}): TvProviderChannel[] => {
  const groups = new Map<string, { name: string; order: number }>()
  for (const category of categories) {
    if (category.category_id === undefined || groups.has(category.category_id)) continue
    groups.set(category.category_id, {
      name: collapse(category.category_name ?? ''),
      order: groups.size,
    })
  }
  const seen = new Set<number>()
  const kept: { channel: TvProviderChannel; order: number; num: number; index: number }[] = []
  streams.forEach((stream, index) => {
    const streamId = stream.stream_id
    if (streamId === undefined || streamId <= 0 || seen.has(streamId)) return
    if (stream.stream_type !== undefined && !liveStreamTypes.has(stream.stream_type.toLowerCase()))
      return
    const name = collapse(stream.name ?? '')
    if (name === '') return
    seen.add(streamId)
    const group = stream.category_id === undefined ? undefined : groups.get(stream.category_id)
    const number = stream.num !== undefined && stream.num > 0 ? stream.num : undefined
    const logoUrl =
      stream.stream_icon !== undefined && isHttpUrl(stream.stream_icon)
        ? stream.stream_icon
        : undefined
    kept.push({
      channel: {
        key: `stream:${streamId}`,
        name,
        ...(number === undefined ? {} : { number }),
        group: group?.name ?? '',
        ...(logoUrl === undefined ? {} : { logoUrl }),
        upstream: storedUpstream(streamId, format),
        ...(stream.epg_channel_id === undefined ? {} : { guideKey: stream.epg_channel_id }),
      },
      order: group?.order ?? groups.size,
      num: number ?? Number.MAX_SAFE_INTEGER,
      index,
    })
  })
  kept.sort((a, b) => a.order - b.order || a.num - b.num || a.index - b.index)
  return kept.map(({ channel }) => channel)
}

/** Context of a failure: the panel's host and a fixed reason, never a URL (§29.2). */
export const xtreamContextOf = (host: string, failure: XtreamFailure) => ({
  host,
  reason: failure.reason,
  ...(failure.kind === 'unreachable' && failure.status !== undefined
    ? { status: failure.status }
    : {}),
})
