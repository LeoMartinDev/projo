import { lookup as dnsLookup } from 'node:dns/promises'
import { isIP } from 'node:net'

import { appError, err, ok, type Result } from '@projo/shared'

import {
  TV_LOGO_MAX_BYTES,
  type TvLogoDownloader,
  type TvLogoError,
  tvLogoTypeOf,
} from '../../core/tv/logo.ts'
import { fetchFailureReason } from './fetch-failure.ts'

export const TV_LOGO_TIMEOUT_MS = 15_000
/** Redirects followed for one logo, each hop checked like the first URL. */
export const TV_LOGO_MAX_REDIRECTS = 5

type Fetch = (input: string, init: RequestInit) => Promise<Response>
/** Every address a host name resolves to. */
type Lookup = (hostname: string) => Promise<string[]>

const hostOf = (url: string): string => (URL.canParse(url) ? new URL(url).host : '')

const defaultLookup: Lookup = async (hostname) =>
  (await dnsLookup(hostname, { all: true, verbatim: true })).map((entry) => entry.address)

const ipv4Parts = (address: string): number[] | undefined => {
  const parts = address.split('.').map(Number)
  return parts.length === 4 && parts.every((part) => Number.isInteger(part) && part >= 0)
    ? parts
    : undefined
}

/** The IPv4 address an IPv6 one embeds (`::ffff:a.b.c.d`, `::ffff:7f00:1`), if any. */
const mappedIpv4 = (address: string): string | undefined => {
  const dotted = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/iu.exec(address)
  if (dotted?.[1] !== undefined) return dotted[1]
  const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/iu.exec(address)
  if (hex?.[1] === undefined || hex[2] === undefined) return undefined
  const high = Number.parseInt(hex[1], 16)
  const low = Number.parseInt(hex[2], 16)
  return [high >> 8, high & 0xff, low >> 8, low & 0xff].join('.')
}

/**
 * Whether a logo may not be read from this address (§29.2): loopback, link-local (cloud
 * metadata), unspecified, multicast and broadcast. Private LAN ranges stay allowed (a Freebox
 * serves its logos from the LAN). `allowLoopback` is a test seam (the test provider is local).
 */
export const isRefusedLogoAddress = (
  address: string,
  { allowLoopback = false }: { allowLoopback?: boolean } = {},
): boolean => {
  const bare = address.replace(/^\[|\]$/gu, '').replace(/%.*$/u, '')
  const version = isIP(bare)
  if (version === 0) return true
  const v4 = version === 4 ? bare : mappedIpv4(bare)
  if (v4 !== undefined) {
    const parts = ipv4Parts(v4)
    if (parts === undefined) return true
    const [a = 0, b = 0] = parts
    if (a === 127) return !allowLoopback
    return (
      a === 0 || (a === 169 && b === 254) || a >= 224 // multicast, reserved, broadcast
    )
  }
  const lower = bare.toLowerCase()
  if (lower === '::1') return !allowLoopback
  return (
    lower === '::' ||
    /^fe[89ab][0-9a-f]:/u.test(lower) || // fe80::/10
    lower.startsWith('ff') // multicast
  )
}

/**
 * Downloads a channel logo (§29.2): `http`/`https`, 15 s and 1 MB at most, images only. The
 * playlist is a third party's: every host, redirects included (followed by hand, at most 5),
 * is resolved and refused when it is a loopback, link-local, unspecified or multicast address.
 */
export const createTvLogoDownloader = ({
  fetch: doFetch = (input, init) => fetch(input, init),
  lookup = defaultLookup,
  allowLoopback = false,
  timeoutMs = TV_LOGO_TIMEOUT_MS,
  maxBytes = TV_LOGO_MAX_BYTES,
}: {
  fetch?: Fetch
  lookup?: Lookup
  allowLoopback?: boolean
  timeoutMs?: number
  maxBytes?: number
} = {}): TvLogoDownloader => ({
  download: async ({ url, userAgent, signal }) => {
    // Never the upstream error as `cause` nor its message: Bun's may carry the URL (§20).
    const failed = (reason: string) =>
      err(
        appError('tv/logo_unavailable', 'the channel logo could not be downloaded', {
          context: { host: hostOf(url), reason },
        }),
      )
    const timeout = AbortSignal.timeout(timeoutMs)
    const requestSignal = signal === undefined ? timeout : AbortSignal.any([signal, timeout])

    /** `undefined` when the URL may be read, else why not. */
    const refusal = async (target: string): Promise<string | undefined> => {
      if (!/^https?:\/\//iu.test(target) || !URL.canParse(target)) return 'unsupported_url'
      const { hostname } = new URL(target)
      const literal = hostname.replace(/^\[|\]$/gu, '')
      const addresses =
        isIP(literal) === 0
          ? await lookup(hostname).then(
              (found) => ({ ok: true as const, found }),
              (cause: unknown) => ({ ok: false as const, reason: fetchFailureReason(cause) }),
            )
          : { ok: true as const, found: [literal] }
      if (!addresses.ok) return addresses.reason
      return addresses.found.length === 0 ||
        addresses.found.some((address) => isRefusedLogoAddress(address, { allowLoopback }))
        ? 'refused_address'
        : undefined
    }

    const request = async (
      target: string,
      redirects: number,
    ): Promise<Result<Response, TvLogoError>> => {
      const refused = await refusal(target)
      if (refused !== undefined) return failed(refused)
      const response = await doFetch(target, {
        headers: userAgent === undefined ? {} : { 'User-Agent': userAgent },
        redirect: 'manual',
        signal: requestSignal,
      }).then(
        (value) => ({ ok: true as const, value }),
        (cause: unknown) => ({ ok: false as const, reason: fetchFailureReason(cause) }),
      )
      if (!response.ok) return failed(response.reason)
      const location = response.value.headers.get('location') ?? undefined
      if (response.value.status < 300 || response.value.status >= 400 || location === undefined)
        return ok(response.value)
      await response.value.body?.cancel().catch(() => {})
      if (redirects >= TV_LOGO_MAX_REDIRECTS) return failed('too_many_redirects')
      if (!URL.canParse(location, target)) return failed('unsupported_url')
      return request(new URL(location, target).href, redirects + 1)
    }

    const answered = await request(url, 0)
    if (!answered.ok) return answered
    const response = answered.value
    if (!response.ok || !response.body) {
      await response.body?.cancel().catch(() => {})
      return failed(`http_${response.status}`)
    }
    const reader = response.body.getReader()
    const parts: Uint8Array[] = []
    let size = 0
    for (;;) {
      const chunk = await reader.read().then(
        (value) => ({ ok: true as const, value }),
        (cause: unknown) => ({ ok: false as const, reason: fetchFailureReason(cause) }),
      )
      if (!chunk.ok) return failed(chunk.reason)
      const { done, value } = chunk.value
      if (done) break
      size += value.byteLength
      if (size > maxBytes) {
        await reader.cancel().catch(() => {})
        return failed('too_large')
      }
      parts.push(value)
    }
    const bytes = new Uint8Array(size)
    let offset = 0
    for (const part of parts) {
      bytes.set(part, offset)
      offset += part.byteLength
    }
    const type = tvLogoTypeOf(bytes)
    return type === undefined ? failed('not_an_image') : ok({ bytes, type })
  },
})
