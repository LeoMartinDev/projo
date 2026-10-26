/**
 * Player prototype only (§26.6): a stand-in for what slice 5 puts in the server (§10.4 "Delivery
 * inside HLS", §20 capability URLs). Starts a playback session as a bearer device, keeps it alive,
 * and serves on `port`, without auth:
 * - `/master.m3u8`: the session's video playlist + one WebVTT rendition per text subtitle track
 * - `/subs/<trackId>.m3u8` and `.vtt`: a one-segment subtitle playlist over the server's WebVTT
 * - `/api/v1/*`: proxied to the server with the bearer (playlist and segments)
 *
 * PROJO_SERVER=http://localhost:8095 PROJO_TOKEN=… PROJO_ITEM=<itemId> bun hls-wrap.ts [port]
 */
import type { PlaybackSessionDto } from '@projo/shared/api/playback'

const server = process.env.PROJO_SERVER ?? 'http://localhost:8095'
const token = process.env.PROJO_TOKEN ?? ''
const itemId = process.env.PROJO_ITEM ?? ''
const port = Number(process.argv[2] ?? 8096)
if (token === '' || itemId === '') {
  console.error('PROJO_TOKEN and PROJO_ITEM are required')
  process.exit(1)
}
const auth = { Authorization: `Bearer ${token}` }

const created = await fetch(`${server}/api/v1/playback/sessions`, {
  method: 'POST',
  headers: { ...auth, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    itemId,
    startPositionMs: 0,
    // What AVPlayer decodes; `native` HLS. An mp4/mov source still goes `direct` until slice 5.
    capabilities: {
      videoCodecs: ['avc1', 'hvc1'],
      audioCodecs: ['mp4a.40.2', 'ac-3', 'ec-3'],
      hls: 'native',
    },
  }),
})
if (!created.ok) {
  console.error('session refused', created.status, await created.text())
  process.exit(1)
}
const session = (await created.json()) as PlaybackSessionDto
if (session.stream.type !== 'hls') {
  console.error(`the server chose ${session.mode}: pick an MKV (or a source that needs remux)`)
  process.exit(1)
}
const durationS = Math.ceil((session.durationMs ?? 0) / 1000)
const tracks = session.subtitleTracks.filter((track) => track.delivery === 'vtt')
const videoPlaylist = session.stream.url

const master = [
  '#EXTM3U',
  '#EXT-X-VERSION:6',
  '#EXT-X-INDEPENDENT-SEGMENTS',
  ...tracks.map((track) =>
    [
      '#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs"',
      `NAME="${track.title ?? track.language ?? track.id}"`,
      `LANGUAGE="${track.language ?? 'und'}"`,
      `DEFAULT=${track.id === session.selectedSubtitleTrackId ? 'YES' : 'NO'}`,
      'AUTOSELECT=YES',
      `FORCED=${track.forced ? 'YES' : 'NO'}`,
      `URI="subs/${track.id}.m3u8"`,
    ].join(','),
  ),
  `#EXT-X-STREAM-INF:BANDWIDTH=8000000${tracks.length > 0 ? ',SUBTITLES="subs"' : ''}`,
  videoPlaylist,
  '',
].join('\n')

const subtitlePlaylist = (trackId: string) =>
  [
    '#EXTM3U',
    '#EXT-X-VERSION:6',
    `#EXT-X-TARGETDURATION:${durationS}`,
    '#EXT-X-MEDIA-SEQUENCE:0',
    '#EXT-X-PLAYLIST-TYPE:VOD',
    `#EXTINF:${durationS}.000,`,
    `${trackId}.vtt`,
    '#EXT-X-ENDLIST',
    '',
  ].join('\n')

// The fMP4 segments carry source time + 10 s (`outputTimestampOffsetS` of the server's
// ffmpeg-args.ts): cue 00:00 = media time 10 s = 900000 at 90 kHz.
const withTimestampMap = (vtt: string) =>
  vtt.replace(
    /^WEBVTT[^\n]*\n/,
    (header) => `${header}X-TIMESTAMP-MAP=MPEGTS:900000,LOCAL:00:00:00.000\n`,
  )

const heartbeat = () =>
  fetch(`${server}/api/v1/playback/sessions/${session.id}/heartbeat`, {
    method: 'PUT',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ positionMs: 0 }),
  })
const keepAlive = setInterval(heartbeat, session.heartbeatIntervalMs)

const mpegurl = { 'Content-Type': 'application/vnd.apple.mpegurl', 'Cache-Control': 'no-cache' }

Bun.serve({
  port,
  idleTimeout: 60,
  fetch: async (request) => {
    const { pathname, search } = new URL(request.url)
    console.log(request.method, pathname, request.headers.get('range') ?? '')
    if (pathname === '/master.m3u8') return new Response(master, { headers: mpegurl })
    const subtitle = /^\/subs\/([^/]+)\.(m3u8|vtt)$/.exec(pathname)
    const track = tracks.find((candidate) => candidate.id === subtitle?.[1])
    if (track?.url !== undefined) {
      if (subtitle?.[2] === 'm3u8')
        return new Response(subtitlePlaylist(track.id), { headers: mpegurl })
      const vtt = await fetch(`${server}${track.url}`, { headers: auth })
      return new Response(withTimestampMap(await vtt.text()), {
        status: vtt.status,
        headers: { 'Content-Type': 'text/vtt; charset=utf-8' },
      })
    }
    if (!pathname.startsWith('/api/v1/stream/')) return new Response('not found', { status: 404 })
    const range = request.headers.get('range') ?? undefined
    const upstream = await fetch(`${server}${pathname}${search}`, {
      headers: { ...auth, ...(range === undefined ? {} : { Range: range }) },
      signal: request.signal,
    })
    const headers = ['content-type', 'content-length', 'content-range', 'accept-ranges'].flatMap(
      (name) => {
        const value = upstream.headers.get(name) ?? undefined
        return value === undefined ? [] : [[name, value] as [string, string]]
      },
    )
    return new Response(upstream.body, { status: upstream.status, headers })
  },
})

const stop = async () => {
  clearInterval(keepAlive)
  await fetch(`${server}/api/v1/playback/sessions/${session.id}`, {
    method: 'DELETE',
    headers: auth,
  })
  process.exit(0)
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)

console.log(`session ${session.id} (${session.mode}), ${tracks.length} text subtitle track(s)`)
console.log(`master: http://<this machine>:${port}/master.m3u8`)
console.log(
  `deep link: projo://dev-player?url=${encodeURIComponent(`http://localhost:${port}/master.m3u8`)}`,
)
