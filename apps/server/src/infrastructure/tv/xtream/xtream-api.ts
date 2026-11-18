import { z } from 'zod'

import { fetchFailureReason } from '../fetch-failure.ts'
import { fetchFollowingRedirects } from '../fetch-redirects.ts'

/** Each call to the panel (§29.2): 60 s and 64 MB at most, like an M3U playlist. */
export const XTREAM_TIMEOUT_MS = 60_000
export const XTREAM_MAX_BYTES = 64 * 1024 * 1024

export type Fetch = (input: string, init: RequestInit) => Promise<Response>

export type XtreamCallOptions = { fetch: Fetch; timeoutMs: number; maxBytes: number }

/**
 * Why a call to the panel failed: `unreachable` (network, timeout, an HTTP error status; a fixed
 * reason, never the runtime's message, which may quote the URL and its credentials), `refused`
 * (the account: `auth_failed`, `expired`…), or `invalid` (`not_xtream`, `too_large`…).
 */
export type XtreamFailure =
  | { kind: 'unreachable'; reason: string; status?: number }
  | { kind: 'refused'; reason: string }
  | { kind: 'invalid'; reason: string }

export type XtreamAnswer<T> = { ok: true; value: T } | { ok: false; failure: XtreamFailure }

export const xtreamFail = (failure: XtreamFailure): { ok: false; failure: XtreamFailure } => ({
  ok: false,
  failure,
})

type BodyRead =
  { kind: 'ok'; text: string } | { kind: 'too_large' } | { kind: 'failed'; cause: unknown }

const readBody = async (body: ReadableStream<Uint8Array>, maxBytes: number): Promise<BodyRead> => {
  const reader = body.getReader()
  const decoder = new TextDecoder('utf-8')
  const parts: string[] = []
  let size = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > maxBytes) {
        await reader.cancel().catch(() => {})
        return { kind: 'too_large' }
      }
      parts.push(decoder.decode(value, { stream: true }))
    }
    parts.push(decoder.decode())
    return { kind: 'ok', text: parts.join('') }
  } catch (cause) {
    return { kind: 'failed', cause }
  }
}

const parseJson = (text: string): { ok: true; value: unknown } | { ok: false } => {
  try {
    return { ok: true, value: JSON.parse(text) as unknown }
  } catch {
    return { ok: false }
  }
}

/**
 * `GET url` read as JSON, bounded in time and size, redirects followed one by one but never from
 * `https` down to `http` (§29.2: panels move behind load balancers and to `https`; a downgrade
 * would send the credentials in clear). An HTTP 401 is the panel refusing the account.
 */
export const getXtreamJson = async (
  url: string,
  { fetch: doFetch, timeoutMs, maxBytes }: XtreamCallOptions,
  signal?: AbortSignal,
): Promise<XtreamAnswer<unknown>> => {
  const timeout = AbortSignal.timeout(timeoutMs)
  const fetched = await fetchFollowingRedirects(
    url,
    {
      headers: { Accept: 'application/json' },
      signal: signal === undefined ? timeout : AbortSignal.any([signal, timeout]),
    },
    doFetch,
  )
  if (!fetched.ok) return xtreamFail({ kind: 'unreachable', reason: fetched.reason })
  const { response } = fetched
  if (!response.ok || !response.body) {
    await response.body?.cancel().catch(() => {})
    if (response.status === 401) return xtreamFail({ kind: 'refused', reason: 'auth_failed' })
    return response.ok
      ? xtreamFail({ kind: 'invalid', reason: 'not_xtream' })
      : xtreamFail({ kind: 'unreachable', reason: 'http_status', status: response.status })
  }
  const read = await readBody(response.body, maxBytes)
  if (read.kind === 'failed')
    return xtreamFail({ kind: 'unreachable', reason: fetchFailureReason(read.cause) })
  if (read.kind === 'too_large') return xtreamFail({ kind: 'invalid', reason: 'too_large' })
  const json = parseJson(read.text)
  return json.ok ? json : xtreamFail({ kind: 'invalid', reason: 'not_xtream' })
}

/** A whole number written as a number or a string (`"12"`); anything else counts as absent. */
export const integerOf = (value: unknown): number | undefined => {
  if (typeof value === 'number') return Number.isSafeInteger(value) ? value : undefined
  if (typeof value !== 'string' || !/^\s*-?\d{1,15}\s*$/u.test(value)) return undefined
  return Number(value.trim())
}

/** A text written as a string or a number (`category_id`), trimmed; empty counts as absent. */
export const textOf = (value: unknown, max: number): string | undefined => {
  const text = typeof value === 'number' && Number.isFinite(value) ? String(value) : value
  if (typeof text !== 'string') return undefined
  const trimmed = text.trim()
  return trimmed === '' || trimmed.length > max ? undefined : trimmed
}

// Optional after the transform: a missing key and an unreadable value both count as absent.
const lenientInteger = z.unknown().transform(integerOf).optional()
const lenientText = (max: number) =>
  z
    .unknown()
    .transform((value) => textOf(value, max))
    .optional()

/** `user_info` of the account (no `action`); its other fields are ignored (§29.2). */
const accountSchema = z.object({
  user_info: z.object({
    auth: lenientInteger,
    status: lenientText(40),
    exp_date: lenientInteger,
    max_connections: lenientInteger,
    allowed_output_formats: z
      .unknown()
      .transform((value) =>
        Array.isArray(value)
          ? value.flatMap((format) => (typeof format === 'string' ? [format.toLowerCase()] : []))
          : undefined,
      )
      .optional(),
  }),
})

export type XtreamAccount = {
  auth?: number
  status?: string
  /** Unix seconds. */
  expiresAt?: number
  maxConnections?: number
  outputFormats?: string[]
}

/** The account answer, or `undefined` when it is not the API's shape. */
export const xtreamAccountOf = (value: unknown): XtreamAccount | undefined => {
  const parsed = accountSchema.safeParse(value)
  if (!parsed.success) return undefined
  const info = parsed.data.user_info
  return {
    ...(info.auth === undefined ? {} : { auth: info.auth }),
    ...(info.status === undefined ? {} : { status: info.status }),
    ...(info.exp_date === undefined ? {} : { expiresAt: info.exp_date }),
    ...(info.max_connections === undefined ? {} : { maxConnections: info.max_connections }),
    ...(info.allowed_output_formats === undefined
      ? {}
      : { outputFormats: info.allowed_output_formats }),
  }
}

/** A category of `get_live_categories`. */
export const xtreamCategorySchema = z.object({
  category_id: lenientText(100),
  category_name: lenientText(200),
})
export type XtreamCategory = z.infer<typeof xtreamCategorySchema>

/** An entry of `get_live_streams`; fields as panels write them (numbers or strings, `null`s). */
export const xtreamStreamSchema = z.object({
  stream_id: lenientInteger,
  num: lenientInteger,
  name: lenientText(500),
  stream_type: lenientText(40),
  stream_icon: lenientText(2048),
  epg_channel_id: lenientText(200),
  category_id: lenientText(100),
})
export type XtreamStream = z.infer<typeof xtreamStreamSchema>

export const arraySchema = z.array(z.unknown())
