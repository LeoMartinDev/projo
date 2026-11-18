import { z } from 'zod'

import { fetchFailureReason } from '../fetch-failure.ts'

/** Each call to the box (§29.2): 30 s and 16 MB at most. */
export const FREEBOX_TIMEOUT_MS = 30_000
export const FREEBOX_MAX_BYTES = 16 * 1024 * 1024
/** A whole guide read (§29.3): its 25 calls share this deadline, like an XMLTV fetch. */
export const FREEBOX_GUIDE_TIMEOUT_MS = 5 * 60_000
/** The TV API is read at this version, which later Freebox OS versions keep serving. */
export const FREEBOX_TV_API_VERSION = 8

export type Fetch = (input: string, init: RequestInit) => Promise<Response>

export type FreeboxCallOptions = { fetch: Fetch; timeoutMs: number; maxBytes: number }

/**
 * Why a call to the box failed: `unreachable` (network, timeout, an HTTP error status without the
 * API's envelope; a fixed reason, never the runtime's message), or `invalid` (`not_freebox`,
 * `api_error` with the HTTP status it came with, `too_large`…).
 */
export type FreeboxFailure =
  | { kind: 'unreachable'; reason: string; status?: number }
  | { kind: 'invalid'; reason: string; errorCode?: string; status?: number }

export type FreeboxAnswer<T> = { ok: true; value: T } | { ok: false; failure: FreeboxFailure }

const fail = (failure: FreeboxFailure): { ok: false; failure: FreeboxFailure } => ({
  ok: false,
  failure,
})

type BodyRead =
  { kind: 'ok'; text: string } | { kind: 'too_large' } | { kind: 'failed'; cause: unknown }

const readBody = async (body: ReadableStream<Uint8Array>, maxBytes: number): Promise<BodyRead> => {
  const reader = body.getReader()
  const decoder = new TextDecoder('utf-8')
  let size = 0
  let text = ''
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > maxBytes) {
        await reader.cancel().catch(() => {})
        return { kind: 'too_large' }
      }
      text += decoder.decode(value, { stream: true })
    }
    return { kind: 'ok', text: text + decoder.decode() }
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

/** Redirects a call follows, each on the box's origin (§29.2). */
const MAX_REDIRECTS = 5
const redirectStatuses = new Set([301, 302, 303, 307, 308])

type Fetched = { ok: true; response: Response } | { ok: false; failure: FreeboxFailure }

/**
 * `GET url`, following redirects one by one while they stay on the URL's origin: the box's API
 * is a path on its address, so a redirect anywhere else is not the box (`not_freebox`).
 */
const fetchOnBox = async (url: string, doFetch: Fetch, signal: AbortSignal): Promise<Fetched> => {
  const origin = new URL(url).origin
  let current = url
  for (let hop = 0; ; hop += 1) {
    const fetched = await doFetch(current, {
      headers: { Accept: 'application/json' },
      redirect: 'manual',
      signal,
    }).then(
      (response) => ({ ok: true as const, response }),
      (cause: unknown) => ({ ok: false as const, cause }),
    )
    if (!fetched.ok) return fail({ kind: 'unreachable', reason: fetchFailureReason(fetched.cause) })
    const { response } = fetched
    if (!redirectStatuses.has(response.status)) return fetched
    await response.body?.cancel().catch(() => {})
    const location = response.headers.get('location') ?? undefined
    if (location === undefined || !URL.canParse(location, current) || hop >= MAX_REDIRECTS)
      return fail({ kind: 'invalid', reason: 'not_freebox' })
    const next = new URL(location, current)
    if (next.origin !== origin) return fail({ kind: 'invalid', reason: 'not_freebox' })
    current = next.href
  }
}

/**
 * The box's refusal: `success: false` comes with an HTTP error status (403 `auth_required`, 404
 * `invalid_request`…), so an error status whose body is that envelope is the API's answer.
 */
const refusalOf = (text: string, status: number): FreeboxFailure | undefined => {
  const json = parseJson(text)
  if (!json.ok) return undefined
  const answer = resultOf(json.value)
  return !answer.ok && answer.failure.kind === 'invalid' && answer.failure.reason === 'api_error'
    ? { ...answer.failure, status }
    : undefined
}

/** `GET url` read as JSON, bounded in time and size. */
export const getFreeboxJson = async (
  url: string,
  { fetch: doFetch, timeoutMs, maxBytes }: FreeboxCallOptions,
  signal?: AbortSignal,
): Promise<FreeboxAnswer<unknown>> => {
  const timeout = AbortSignal.timeout(timeoutMs)
  const fetched = await fetchOnBox(
    url,
    doFetch,
    signal === undefined ? timeout : AbortSignal.any([signal, timeout]),
  )
  if (!fetched.ok) return fetched
  const { response } = fetched
  const httpStatus: FreeboxFailure = {
    kind: 'unreachable',
    reason: 'http_status',
    status: response.status,
  }
  if (!response.body)
    return fail(response.ok ? { kind: 'invalid', reason: 'not_freebox' } : httpStatus)
  const read = await readBody(response.body, maxBytes)
  if (!response.ok) {
    const refusal = read.kind === 'ok' ? refusalOf(read.text, response.status) : undefined
    return fail(refusal ?? httpStatus)
  }
  if (read.kind === 'failed')
    return fail({ kind: 'unreachable', reason: fetchFailureReason(read.cause) })
  if (read.kind === 'too_large') return fail({ kind: 'invalid', reason: 'too_large' })
  const json = parseJson(read.text)
  return json.ok ? json : fail({ kind: 'invalid', reason: 'not_freebox' })
}

/** `api_base_url` must be a plain path on the box: never another host. */
const apiVersionSchema = z.object({
  api_base_url: z.string().regex(/^\/(?:[A-Za-z0-9_-]+\/)*$/u),
  api_version: z.string().regex(/^\d+(?:\.\d+)*$/u),
})

/** `GET /api_version` (no envelope): the prefix of the TV API, at version 8 (§29.2). */
export const tvApiBaseOf = (value: unknown): FreeboxAnswer<string> => {
  const parsed = apiVersionSchema.safeParse(value)
  if (!parsed.success) return fail({ kind: 'invalid', reason: 'not_freebox' })
  const major = Number(parsed.data.api_version.split('.')[0])
  if (major < FREEBOX_TV_API_VERSION) return fail({ kind: 'invalid', reason: 'api_too_old' })
  return { ok: true, value: `${parsed.data.api_base_url}v${FREEBOX_TV_API_VERSION}/tv/` }
}

const envelopeSchema = z.object({
  success: z.boolean(),
  result: z.unknown().optional(),
  error_code: z.string().optional(),
})

/** The box's `{ success, result }` envelope around every TV answer; `result` as it is. */
export const resultOf = (value: unknown): FreeboxAnswer<unknown> => {
  const parsed = envelopeSchema.safeParse(value)
  if (!parsed.success) return fail({ kind: 'invalid', reason: 'not_freebox' })
  if (!parsed.data.success) {
    const code = parsed.data.error_code
    return fail({
      kind: 'invalid',
      reason: 'api_error',
      // Only a plain identifier reaches errors and logs.
      ...(code !== undefined && /^[A-Za-z][A-Za-z0-9_]{0,39}$/u.test(code)
        ? { errorCode: code }
        : {}),
    })
  }
  return { ok: true, value: parsed.data.result }
}

/** `tv/channels`: every channel of the box by uuid; entries of another shape are skipped. */
export const freeboxChannelSchema = z.object({
  uuid: z.string().min(1).max(200),
  name: z.string(),
  logo_url: z.string().max(2048).optional(),
})
export type FreeboxChannel = z.infer<typeof freeboxChannelSchema>

export const freeboxStreamSchema = z.object({
  quality: z.string().optional(),
  rtsp: z.string().max(4096).optional(),
})
export type FreeboxStream = z.infer<typeof freeboxStreamSchema>

/** An entry of the `freeboxtv` bouquet: a number of the box's numbering and its streams. */
export const freeboxBouquetEntrySchema = z.object({
  uuid: z.string().min(1).max(200),
  number: z.number().int(),
  sub_number: z.number().int().optional(),
  available: z.boolean(),
  streams: z.array(z.unknown()).optional(),
})
export type FreeboxBouquetEntry = z.infer<typeof freeboxBouquetEntrySchema>

/** A programme of `epg/by_time`: `date` and `duration` in seconds. */
export const freeboxProgrammeSchema = z.object({
  date: z.number().int(),
  duration: z.number().int().optional(),
  title: z.string(),
  sub_title: z.string().optional(),
  desc: z.string().optional(),
  category_name: z.string().optional(),
})
export type FreeboxProgramme = z.infer<typeof freeboxProgrammeSchema>

export const objectEntriesSchema = z.record(z.string(), z.unknown())
export const arraySchema = z.array(z.unknown())
