import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

/**
 * An IPTV provider for tests (§29.8): replays `test/fixtures/iptv/`, never a real provider.
 * Text fixtures may hold `{{base}}`, replaced by the server's URL. Each part of the provider
 * is a route of its own, so the later slices add theirs (XMLTV under `/xmltv/`, Xtream's
 * `player_api.php`, the Freebox TV API, the endless MPEG-TS under `/live/`).
 *
 * - `/m3u/<file>`: an M3U playlist of `fixtures/iptv/m3u/` (403 when `requireUserAgent` is set
 *   and the request's `User-Agent` differs);
 * - `/logos/<name>.png|.jpg|.webp|.gif`: a tiny image of that type; `missing*` answers 404, an
 *   `.svg` answers an SVG document, `huge.png` a PNG larger than the logo limit;
 * - `/status/<code>`: an empty answer with that status;
 * - `override(path, response)`: replaces the answer of one path (a changed playlist, a failure).
 */

export const iptvFixturesDir = resolve(import.meta.dirname, '../fixtures/iptv')

export const PNG_BYTES = Uint8Array.from(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64',
  ),
)
const JPEG_BYTES = Uint8Array.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0xff, 0xd9,
])
const WEBP_BYTES = Uint8Array.from([
  0x52, 0x49, 0x46, 0x46, 0x1a, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x4c,
])
const GIF_BYTES = Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00])

const images: Record<string, { bytes: Uint8Array; type: string }> = {
  png: { bytes: PNG_BYTES, type: 'image/png' },
  jpg: { bytes: JPEG_BYTES, type: 'image/jpeg' },
  webp: { bytes: WEBP_BYTES, type: 'image/webp' },
  gif: { bytes: GIF_BYTES, type: 'image/gif' },
}

export type IptvRequest = { path: string; userAgent?: string; referrer?: string }

type Override = () => Response

export const startIptvServer = ({ requireUserAgent }: { requireUserAgent?: string } = {}) => {
  const requests: IptvRequest[] = []
  const overrides = new Map<string, Override>()
  let base = ''

  const text = (relative: string): string | undefined => {
    const file = join(iptvFixturesDir, relative)
    return existsSync(file) ? readFileSync(file, 'utf8').replaceAll('{{base}}', base) : undefined
  }

  const playlist = (request: Request, name: string): Response => {
    if (requireUserAgent !== undefined && request.headers.get('user-agent') !== requireUserAgent)
      return new Response('forbidden', { status: 403 })
    const body = text(`m3u/${name}`)
    return body === undefined
      ? new Response('not found', { status: 404 })
      : new Response(body, {
          headers: {
            'content-type': name.endsWith('.html') ? 'text/html' : 'audio/x-mpegurl',
          },
        })
  }

  const logo = (name: string): Response => {
    if (name.startsWith('missing')) return new Response('not found', { status: 404 })
    if (name.endsWith('.svg'))
      return new Response('<svg xmlns="http://www.w3.org/2000/svg"/>', {
        headers: { 'content-type': 'image/svg+xml' },
      })
    if (name === 'huge.png') {
      const bytes = new Uint8Array(2 * 1024 * 1024)
      bytes.set(PNG_BYTES)
      return new Response(bytes, { headers: { 'content-type': 'image/png' } })
    }
    const image = images[name.slice(name.lastIndexOf('.') + 1)]
    return image === undefined
      ? new Response('not found', { status: 404 })
      : new Response(image.bytes, { headers: { 'content-type': image.type } })
  }

  const server = Bun.serve({
    port: 0,
    fetch: (request) => {
      const url = new URL(request.url)
      const path = url.pathname
      const userAgent = request.headers.get('user-agent') ?? undefined
      const referrer = request.headers.get('referer') ?? undefined
      requests.push({
        path: `${path}${url.search}`,
        ...(userAgent === undefined ? {} : { userAgent }),
        ...(referrer === undefined ? {} : { referrer }),
      })
      const override = overrides.get(path)
      if (override !== undefined) return override()
      const [, root, name = ''] = /^\/([^/]+)\/(.+)$/u.exec(path) ?? []
      if (root === 'm3u') return playlist(request, name)
      if (root === 'logos') return logo(name)
      if (root === 'status') return new Response(undefined, { status: Number(name) || 500 })
      return new Response('not found', { status: 404 })
    },
  })
  base = server.url.origin

  return {
    url: base,
    /** URL of a path on this server. */
    at: (path: string) => `${base}${path.startsWith('/') ? path : `/${path}`}`,
    requests,
    /** The fixture `m3u/<name>` as served (with `{{base}}` replaced). */
    fixture: (name: string): string => {
      const body = text(`m3u/${name}`)
      if (body === undefined) throw new Error(`no iptv fixture m3u/${name}`)
      return body
    },
    /** Serves `body` (or a status, with a `Location`) at `path` until `restore(path)`. */
    override: (path: string, response: string | { status: number; location?: string }) => {
      overrides.set(path, () =>
        typeof response === 'string'
          ? new Response(response.replaceAll('{{base}}', base), {
              headers: { 'content-type': 'audio/x-mpegurl' },
            })
          : new Response(undefined, {
              status: response.status,
              headers: response.location === undefined ? {} : { location: response.location },
            }),
      )
    },
    restore: (path: string) => {
      overrides.delete(path)
    },
    stop: () => server.stop(true),
  }
}

export type IptvServer = ReturnType<typeof startIptvServer>
