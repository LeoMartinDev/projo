import { appError, err, ok, type Result } from '@projo/shared'

import type { M3uSettings } from '../../../core/tv/source.ts'
import type {
  TvChannelListing,
  TvProviderError,
  TvSourceProvider,
} from '../../../core/tv/provider.ts'
import { fetchFailureReason } from '../fetch-failure.ts'
import { createM3uParser, type M3uPlaylist } from './m3u-parser.ts'

export const M3U_TIMEOUT_MS = 60_000
export const M3U_MAX_BYTES = 64 * 1024 * 1024

type Fetch = (input: string, init: RequestInit) => Promise<Response>

export type M3uProvider = {
  listChannels: (input: {
    settings: M3uSettings
    signal?: AbortSignal
  }) => Promise<Result<TvChannelListing, TvProviderError>>
  upstreamOf: TvSourceProvider['upstreamOf']
}

/** The playlist's host, for errors and logs: never its path or query (they carry the secret). */
const hostOf = (url: string): string => (URL.canParse(url) ? new URL(url).host : '')

type ReadOutcome =
  { kind: 'ok'; playlist: M3uPlaylist } | { kind: 'too_large' } | { kind: 'failed'; cause: unknown }

const readPlaylist = async (body: ReadableStream<Uint8Array>, maxBytes: number) => {
  const parser = createM3uParser()
  const decoder = new TextDecoder('utf-8')
  const reader = body.getReader()
  let size = 0
  let rest = ''
  const feed = (text: string) => {
    const lines = (rest + text).split(/\r\n|\n|\r/u)
    rest = lines.pop() ?? ''
    for (const line of lines) parser.push(line)
  }
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > maxBytes) {
        await reader.cancel().catch(() => {})
        return { kind: 'too_large' } satisfies ReadOutcome
      }
      feed(decoder.decode(value, { stream: true }))
    }
    feed(decoder.decode())
    parser.push(rest)
    return { kind: 'ok', playlist: parser.finish() } satisfies ReadOutcome
  } catch (cause) {
    return { kind: 'failed', cause } satisfies ReadOutcome
  }
}

/** The `m3u` connector (§29.2): fetches the playlist and lists its live channels. */
export const createM3uProvider = ({
  fetch: doFetch = (input, init) => fetch(input, init),
  timeoutMs = M3U_TIMEOUT_MS,
  maxBytes = M3U_MAX_BYTES,
}: { fetch?: Fetch; timeoutMs?: number; maxBytes?: number } = {}): M3uProvider => ({
  listChannels: async ({ settings, signal }) => {
    const host = hostOf(settings.playlistUrl)
    // Never the upstream error as `cause` nor its message: Bun's may carry the URL (§20).
    const unreachable = (reason: string, extra: Record<string, unknown> = {}) =>
      err(
        appError('tv/source_unreachable', 'the playlist could not be fetched', {
          context: { host, reason, ...extra },
        }),
      )
    const invalid = (reason: string) =>
      err(
        appError('tv/source_invalid', 'the answer is not a usable playlist', {
          context: { host, reason },
        }),
      )
    const timeout = AbortSignal.timeout(timeoutMs)
    const response = await doFetch(settings.playlistUrl, {
      headers: settings.userAgent === undefined ? {} : { 'User-Agent': settings.userAgent },
      redirect: 'follow',
      signal: signal === undefined ? timeout : AbortSignal.any([signal, timeout]),
    }).then(
      (value) => ({ ok: true as const, value }),
      (cause: unknown) => ({ ok: false as const, cause }),
    )
    if (!response.ok) return unreachable(fetchFailureReason(response.cause))
    if (!response.value.ok || !response.value.body) {
      await response.value.body?.cancel().catch(() => {})
      return unreachable('http_status', { status: response.value.status })
    }
    const read = await readPlaylist(response.value.body, maxBytes)
    if (read.kind === 'failed') return unreachable(fetchFailureReason(read.cause))
    if (read.kind === 'too_large') return invalid('too_large')
    const { playlist } = read
    if (!playlist.header && playlist.entries === 0) return invalid('not_a_playlist')
    if (playlist.channels.length === 0) return invalid('no_live_channel')
    return ok({
      channels: playlist.channels,
      ...(playlist.guideUrl === undefined ? {} : { guideUrl: playlist.guideUrl }),
    })
  },
  upstreamOf: ({ settings, upstream }) => {
    const userAgent = upstream.userAgent ?? settings.userAgent
    return { ...upstream, ...(userAgent === undefined ? {} : { userAgent }) }
  },
})
