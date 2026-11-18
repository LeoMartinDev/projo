import { appError, err, ok } from '@projo/shared'

import type { TvGuideRead, TvGuideSink } from '../../../core/tv/guide.ts'
import { fetchFailureReason } from '../fetch-failure.ts'
import { createXmltvParser } from './xmltv-parser.ts'

export const XMLTV_TIMEOUT_MS = 5 * 60_000
export const XMLTV_MAX_BYTES = 200 * 1024 * 1024
export const XMLTV_MAX_DECODED_BYTES = 1024 * 1024 * 1024

type Fetch = (input: string, init: BunFetchRequestInit) => Promise<Response>

export type XmltvReaderOptions = {
  fetch?: Fetch
  timeoutMs?: number
  /** Bytes received at most (as they come on the wire, before any decompression). */
  maxBytes?: number
  /** Bytes at most once decompressed. */
  maxDecodedBytes?: number
}

type Compression = 'gzip' | 'deflate'

/** The guide's host, for errors and logs: never its path or query (they may carry a secret). */
const hostOf = (url: string): string => (URL.canParse(url) ? new URL(url).host : '')

const isGzip = (bytes: Uint8Array): boolean => bytes[0] === 0x1f && bytes[1] === 0x8b

type ReadOutcome =
  | { kind: 'ok' }
  | { kind: 'too_large' }
  | { kind: 'invalid'; reason: string }
  | { kind: 'failed'; cause: unknown }

/** Counts the bytes going through, and errors past `max`. */
const counting = (max: number, onTooLarge: () => void) => {
  let size = 0
  return new TransformStream<Uint8Array, Uint8Array>({
    transform: (chunk, controller) => {
      size += chunk.byteLength
      if (size > max) {
        onTooLarge()
        controller.error(new RangeError('too large'))
        return
      }
      controller.enqueue(chunk)
    },
  })
}

/** The response body, a failure of its own (network, timeout) reported by `onFailure`. */
const observed = (
  body: ReadableStream<Uint8Array>,
  onFailure: () => void,
): ReadableStream<Uint8Array> => {
  const source = body.getReader()
  return new ReadableStream<Uint8Array>({
    pull: async (controller) => {
      const chunk = await source.read().catch((cause: unknown) => {
        onFailure()
        throw cause
      })
      if (chunk.done) controller.close()
      else controller.enqueue(chunk.value)
    },
    cancel: (reason) => source.cancel(reason),
  })
}

const decompressed = (
  stream: ReadableStream<Uint8Array>,
  format: Compression,
): ReadableStream<Uint8Array> =>
  stream.pipeThrough(
    new DecompressionStream(format) as ReadableWritablePair<Uint8Array, Uint8Array>,
  )

const codingFormats = new Map<string, Compression>([
  ['gzip', 'gzip'],
  ['x-gzip', 'gzip'],
  ['deflate', 'deflate'],
])

/**
 * The `Content-Encoding` codings to undo, in the order they were applied (`identity` left out),
 * or `undefined` when one of them is not supported.
 */
const contentCodings = (header: string | undefined): Compression[] | undefined => {
  const codings = (header ?? '')
    .split(',')
    .map((coding) => coding.trim().toLowerCase())
    .filter((coding) => coding !== '' && coding !== 'identity')
  const formats = codings.flatMap((coding) => {
    const format = codingFormats.get(coding)
    return format === undefined ? [] : [format]
  })
  return formats.length === codings.length ? formats : undefined
}

/** The stream as it goes, its first bytes read to see whether it is gzip (`1f 8b`). */
const decompressedIfGzip = async (
  stream: ReadableStream<Uint8Array>,
): Promise<ReadableStream<Uint8Array>> => {
  const source = stream.getReader()
  let head = new Uint8Array(0)
  let done = false
  // Two bytes tell: read until they are there (a first chunk of one byte is possible).
  while (head.byteLength < 2 && !done) {
    const chunk = await source.read()
    if (chunk.done) done = true
    else {
      const joined = new Uint8Array(head.byteLength + chunk.value.byteLength)
      joined.set(head)
      joined.set(chunk.value, head.byteLength)
      head = joined
    }
  }
  const replay = new ReadableStream<Uint8Array>({
    start: (controller) => {
      if (head.byteLength > 0) controller.enqueue(head)
      if (done) controller.close()
    },
    pull: async (controller) => {
      const chunk = await source.read()
      if (chunk.done) controller.close()
      else controller.enqueue(chunk.value)
    },
    cancel: (reason) => source.cancel(reason),
  })
  return isGzip(head) ? decompressed(replay, 'gzip') : replay
}

const readGuideBody = async (
  body: ReadableStream<Uint8Array>,
  sink: TvGuideSink,
  {
    codings,
    maxBytes,
    maxDecodedBytes,
  }: { codings: readonly Compression[]; maxBytes: number; maxDecodedBytes: number },
): Promise<ReadOutcome> => {
  let tooLarge = false
  let bodyFailed = false
  const parser = createXmltvParser(sink)
  const decoder = new TextDecoder('utf-8')
  try {
    // The bytes as received count against `maxBytes`, before any decompression.
    const received = observed(body, () => (bodyFailed = true)).pipeThrough(
      counting(maxBytes, () => (tooLarge = true)),
    )
    // The content codings, last applied first, then a `.gz` file told by its signature.
    const decoded = (
      await decompressedIfGzip(codings.toReversed().reduce(decompressed, received))
    ).pipeThrough(counting(maxDecodedBytes, () => (tooLarge = true)))
    const reader = decoded.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      const pushed = parser.push(decoder.decode(value, { stream: true }))
      if (!pushed.ok) {
        await reader.cancel().catch(() => {})
        return { kind: 'invalid', reason: pushed.error }
      }
    }
    const last = parser.push(decoder.decode())
    const finished = last.ok ? parser.finish() : last
    return finished.ok ? { kind: 'ok' } : { kind: 'invalid', reason: finished.error }
  } catch (cause) {
    if (tooLarge) return { kind: 'too_large' }
    // Not the body's failure: the decompression's (a corrupt gzip or deflate).
    return bodyFailed ? { kind: 'failed', cause } : { kind: 'invalid', reason: 'corrupt' }
  }
}

/**
 * Reads an XMLTV guide from `url` as a stream into `sink` (§29.3): the source's `User-Agent`,
 * redirects followed, 5 minutes at most, 200 MB received (as they come) and 1 GB decompressed at
 * most. A gzip or deflate `Content-Encoding` and a gzip signature (a `.gz` file) are undone here,
 * never by the client, so that the received bytes are counted before decompression. Decoded as
 * UTF-8.
 */
export const readXmltv = async (
  {
    url,
    userAgent,
    sink,
    signal,
  }: { url: string; userAgent?: string; sink: TvGuideSink; signal?: AbortSignal },
  {
    fetch: doFetch = (input, init) => fetch(input, init),
    timeoutMs = XMLTV_TIMEOUT_MS,
    maxBytes = XMLTV_MAX_BYTES,
    maxDecodedBytes = XMLTV_MAX_DECODED_BYTES,
  }: XmltvReaderOptions = {},
): Promise<TvGuideRead> => {
  const host = hostOf(url)
  // Never the upstream error as `cause` nor its message: Bun's may carry the URL (§20).
  const unreachable = (reason: string, extra: Record<string, unknown> = {}) =>
    err(
      appError('tv/guide_unreachable', 'the guide could not be fetched', {
        context: { host, reason, ...extra },
      }),
    )
  const invalid = (reason: string) =>
    err(
      appError('tv/guide_invalid', 'the answer is not a usable guide', {
        context: { host, reason },
      }),
    )
  const timeout = AbortSignal.timeout(timeoutMs)
  const response = await doFetch(url, {
    headers: {
      'Accept-Encoding': 'gzip, deflate',
      ...(userAgent === undefined ? {} : { 'User-Agent': userAgent }),
    },
    // Undone by `readGuideBody`, after counting the bytes received (§29.3).
    decompress: false,
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
  const codings = contentCodings(response.value.headers.get('content-encoding') ?? undefined)
  if (codings === undefined) {
    await response.value.body.cancel().catch(() => {})
    return invalid('encoding')
  }
  const read = await readGuideBody(response.value.body, sink, {
    codings,
    maxBytes,
    maxDecodedBytes,
  })
  if (read.kind === 'too_large') return invalid('too_large')
  if (read.kind === 'invalid') return invalid(read.reason)
  if (read.kind === 'failed') return unreachable(fetchFailureReason(read.cause))
  return ok({ available: true })
}
