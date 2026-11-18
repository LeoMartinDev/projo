import { appError, err, ok, type Result } from '@projo/shared'

import type { M3uSettings } from '../../../core/tv/source.ts'
import type { TvUpstream } from '../../../core/tv/channel.ts'
import type { TvGuideRead, TvGuideSink } from '../../../core/tv/guide.ts'
import type { TvChannelListing, TvProviderError } from '../../../core/tv/provider.ts'
import { fetchFailureReason } from '../fetch-failure.ts'
import { fetchFollowingRedirects } from '../fetch-redirects.ts'
import { readXmltv, type XmltvReaderOptions } from '../xmltv/xmltv-reader.ts'
import { createM3uParser, type M3uPlaylist } from './m3u-parser.ts'

export const M3U_TIMEOUT_MS = 60_000
export const M3U_MAX_BYTES = 64 * 1024 * 1024

type Fetch = (input: string, init: BunFetchRequestInit) => Promise<Response>

export type M3uProvider = {
  listChannels: (input: {
    settings: M3uSettings
    signal?: AbortSignal
  }) => Promise<Result<TvChannelListing, TvProviderError>>
  readGuide: (input: {
    source: { settings: M3uSettings; discoveredGuideUrl?: string }
    sink: TvGuideSink
    signal?: AbortSignal
  }) => Promise<TvGuideRead>
  upstreamOf: (input: { settings: M3uSettings; upstream: TvUpstream }) => TvUpstream
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
  guide = {},
}: {
  fetch?: Fetch
  timeoutMs?: number
  maxBytes?: number
  /** The XMLTV reader's options (test seams: limits and timeout). */
  guide?: XmltvReaderOptions
} = {}): M3uProvider => ({
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
    // Redirects one hop at a time, never from https down to http: the URL carries the secret.
    const followed = await fetchFollowingRedirects(
      settings.playlistUrl,
      {
        headers: settings.userAgent === undefined ? {} : { 'User-Agent': settings.userAgent },
        signal: signal === undefined ? timeout : AbortSignal.any([signal, timeout]),
      },
      doFetch,
    )
    if (!followed.ok) return unreachable(followed.reason)
    const { response } = followed
    if (!response.ok || !response.body) {
      await response.body?.cancel().catch(() => {})
      return unreachable('http_status', { status: response.status })
    }
    const read = await readPlaylist(response.body, maxBytes)
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
  // The XMLTV URL of the settings, else the one the playlist announces (§29.3).
  readGuide: async ({ source, sink, signal }) => {
    const url = source.settings.guideUrl ?? source.discoveredGuideUrl
    if (url === undefined) return ok({ available: false })
    const { userAgent } = source.settings
    return readXmltv(
      {
        url,
        sink,
        ...(userAgent === undefined ? {} : { userAgent }),
        ...(signal === undefined ? {} : { signal }),
      },
      { fetch: doFetch, ...guide },
    )
  },
  upstreamOf: ({ settings, upstream }) => {
    const userAgent = upstream.userAgent ?? settings.userAgent
    return { ...upstream, ...(userAgent === undefined ? {} : { userAgent }) }
  },
})
