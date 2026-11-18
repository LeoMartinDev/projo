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
 * - `/live/<variant>.ts`: an endless MPEG-TS encoded by ffmpeg in real time (`-re`, 320×180,
 *   1 s GOP), one encoder per request, killed when the client goes: `progressive` (H.264 and
 *   AAC), `interlaced` (H.264 top field first and AAC), `hevc` (HEVC and AAC: needs libx265),
 *   `mp2` (H.264 and MP2 audio), `described` (H.264, an AAC audio description first, then the
 *   main track in MP2);
 *   `failLive()` answers 503 to them and cuts the running ones until `restoreLive()`;
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

const images: Record<string, { bytes: Uint8Array<ArrayBuffer>; type: string }> = {
  png: { bytes: PNG_BYTES, type: 'image/png' },
  jpg: { bytes: JPEG_BYTES, type: 'image/jpeg' },
  webp: { bytes: WEBP_BYTES, type: 'image/webp' },
  gif: { bytes: GIF_BYTES, type: 'image/gif' },
}

export type IptvRequest = { path: string; userAgent?: string; referrer?: string }

type Override = () => Response

const h264 = ['-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency']

/** Each variant's maps, filters and codecs; the encoder adds the 1 s GOP and 4:2:0. */
const liveVariants: Record<string, string[]> = {
  progressive: ['-map', '0:v', '-map', '1:a', '-c:a', 'aac', '-b:a', '96k', ...h264],
  hevc: [
    '-map',
    '0:v',
    '-map',
    '1:a',
    '-c:a',
    'aac',
    '-b:a',
    '96k',
    '-c:v',
    'libx265',
    '-preset',
    'ultrafast',
    '-x265-params',
    'log-level=error',
  ],
  interlaced: [
    '-map',
    '0:v',
    '-map',
    '1:a',
    '-vf',
    'setfield=tff',
    '-flags',
    '+ildct+ilme',
    '-c:a',
    'aac',
    '-b:a',
    '96k',
    ...h264,
  ],
  mp2: ['-map', '0:v', '-map', '1:a', '-c:a', 'mp2', '-b:a', '128k', ...h264],
  described: [
    '-map',
    '0:v',
    '-map',
    '1:a',
    '-map',
    '1:a',
    '-c:a:0',
    'aac',
    '-b:a:0',
    '96k',
    '-disposition:a:0',
    'visual_impaired',
    '-c:a:1',
    'mp2',
    '-b:a:1',
    '128k',
    ...h264,
  ],
}

/** An endless MPEG-TS of `variant`, read as ffmpeg produces it; `stop` kills the encoder. */
const liveEncoder = (variant: string[]) => {
  const proc = Bun.spawn(
    [
      'ffmpeg',
      '-hide_banner',
      '-loglevel',
      'error',
      '-re',
      '-f',
      'lavfi',
      '-i',
      'testsrc2=size=320x180:rate=25',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:sample_rate=48000',
      ...variant,
      '-g',
      '25',
      '-pix_fmt',
      'yuv420p',
      '-f',
      'mpegts',
      'pipe:1',
    ],
    { stdin: 'ignore', stdout: 'pipe', stderr: 'ignore' },
  )
  const stop = () => {
    proc.kill()
  }
  const reader = proc.stdout.getReader()
  const body = new ReadableStream<Uint8Array>({
    pull: async (controller) => {
      const chunk = await reader.read()
      if (chunk.done) controller.close()
      else controller.enqueue(chunk.value)
    },
    cancel: stop,
  })
  return { body, stop, exited: proc.exited }
}

export const startIptvServer = ({
  requireUserAgent,
  port = 0,
}: {
  requireUserAgent?: string
  // A fixed port (the e2e's provider); 0: any free one.
  port?: number
} = {}) => {
  const requests: IptvRequest[] = []
  const overrides = new Map<string, Override>()
  const encoders = new Set<{ stop: () => void }>()
  let liveFailing = false

  const live = (request: Request, name: string): Response => {
    const variant = liveVariants[name.replace(/\.ts$/u, '')]
    if (variant === undefined) return new Response('not found', { status: 404 })
    if (liveFailing) return new Response('unavailable', { status: 503 })
    const encoder = liveEncoder(variant)
    encoders.add(encoder)
    void encoder.exited.then(() => encoders.delete(encoder))
    request.signal.addEventListener('abort', encoder.stop, { once: true })
    return new Response(encoder.body, { headers: { 'content-type': 'video/mp2t' } })
  }
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
    port,
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
      if (root === 'live') return live(request, name)
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
    /** Live upstream requests so far (`/live/…`). */
    liveRequests: () => requests.filter((r) => r.path.startsWith('/live/')),
    /** Encoders running now: the upstream connections open. */
    liveConnections: () => encoders.size,
    /** The live upstream fails: running streams are cut, new requests answer 503. */
    failLive: () => {
      liveFailing = true
      for (const encoder of encoders) encoder.stop()
    },
    restoreLive: () => {
      liveFailing = false
    },
    stop: () => {
      for (const encoder of encoders) encoder.stop()
      server.stop(true)
    },
  }
}

export type IptvServer = ReturnType<typeof startIptvServer>
