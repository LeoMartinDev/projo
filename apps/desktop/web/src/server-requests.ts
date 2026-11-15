import { fromPromise, type Result } from '@projo/shared/result'

/** The session's bearer token right now, if any. */
export type Bearer = () => string | undefined

/**
 * `init` with the session's `Authorization: Bearer` and never a cookie (§20): the bundled page is
 * another origin than the server's, which answers it with CORS and never with credentials.
 */
export const withBearer = (bearer: Bearer, init?: RequestInit): RequestInit => {
  const headers = new Headers(init?.headers)
  const token = bearer()
  if (token !== undefined) headers.set('authorization', `Bearer ${token}`)
  return { ...init, headers, credentials: 'omit' }
}

/**
 * The file name a `Content-Disposition` gives (`filename*=UTF-8''…` first, then `filename="…"`),
 * else `fallback`.
 */
export const dispositionFilename = (header: string | undefined, fallback: string): string => {
  if (header === undefined) return fallback
  const extended = /filename\*\s*=\s*utf-8''([^;]+)/i.exec(header)?.[1]?.trim()
  if (extended !== undefined && extended !== '') return percentDecoded(extended)
  const plain = /filename\s*=\s*(?:"([^"]*)"|([^;\s]+))/i.exec(header)
  const name = (plain?.[1] ?? plain?.[2])?.trim()
  return name === undefined || name === '' ? fallback : name
}

/** RFC 5987 percent-decoding as UTF-8, never throwing (a malformed sequence decodes as U+FFFD). */
const percentDecoded = (text: string): string => {
  const encoder = new TextEncoder()
  const bytes: number[] = []
  for (let index = 0; index < text.length; index++) {
    const escape = text.slice(index + 1, index + 3)
    if (text[index] === '%' && /^[0-9a-f]{2}$/i.test(escape)) {
      bytes.push(Number.parseInt(escape, 16))
      index += 2
    } else bytes.push(...encoder.encode(text[index]))
  }
  return new TextDecoder().decode(new Uint8Array(bytes))
}

export type Download = { readonly blob: Blob; readonly filename: string }

export type ServerRequests = {
  apiFetch: (path: string, init?: RequestInit) => Promise<Response>
  /** `GET /api/v1/events` as a stream (for `createFetchEvents`). */
  connectEvents: (signal: AbortSignal) => Promise<Response>
  /** The last heartbeat as the page goes away: a `keepalive` POST (no `sendBeacon`: no header). */
  sendLeave: (path: string, body: string) => void
  /** A GET saved as a file: the answer as a blob and the name the server gives it. */
  fetchDownload: (path: string, filename: string) => Promise<Result<Download, Error>>
}

/** The host's requests to the server (§28.3): `serverOrigin` + a root-relative path, the bearer. */
export const serverRequests = ({
  serverOrigin,
  bearer,
  fetch: send,
}: {
  serverOrigin: string
  bearer: Bearer
  fetch: (url: string, init: RequestInit) => Promise<Response>
}): ServerRequests => ({
  apiFetch: (path, init) => send(`${serverOrigin}${path}`, withBearer(bearer, init)),
  connectEvents: (signal) =>
    send(
      `${serverOrigin}/api/v1/events`,
      withBearer(bearer, { signal, headers: { accept: 'text/event-stream' } }),
    ),
  sendLeave: (path, body) => {
    void send(
      `${serverOrigin}${path}`,
      withBearer(bearer, {
        method: 'POST',
        body,
        keepalive: true,
        headers: { 'content-type': 'application/json' },
      }),
    ).catch(() => undefined)
  },
  fetchDownload: (path, filename) =>
    fromPromise(
      async () => {
        const response = await send(`${serverOrigin}${path}`, withBearer(bearer))
        if (!response.ok) throw new Error(`download answered HTTP ${response.status}`)
        return {
          blob: await response.blob(),
          filename: dispositionFilename(
            response.headers.get('content-disposition') ?? undefined,
            filename,
          ),
        }
      },
      (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
    ),
})
