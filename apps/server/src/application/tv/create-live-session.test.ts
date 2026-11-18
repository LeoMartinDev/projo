import { describe, expect, test } from 'bun:test'

import type { ClientCapabilities } from '@projo/shared/api/playback'

import { createLiveWorld, sampleProbe } from '../../../test/support/live-world.ts'

const capabilities: ClientCapabilities = {
  videoCodecs: ['avc1'],
  audioCodecs: ['mp4a.40.2'],
  hls: 'mse',
}

const open = (
  world: ReturnType<typeof createLiveWorld>,
  channelId: string,
  accountId = 'leo',
  signal?: AbortSignal,
) =>
  world.createLiveSession({
    channelId,
    accountId,
    profileId: `${accountId}-profile`,
    authSessionId: `${accountId}-auth`,
    capabilities,
    ...(signal === undefined ? {} : { signal }),
  })

describe('createLiveSession (§29.4)', () => {
  test('answers once the stream is ready, with a capability secret kept hashed', async () => {
    const world = createLiveWorld()
    world.addChannel('a')
    let created: Awaited<ReturnType<typeof open>> | undefined
    void open(world, 'a').then((result) => {
      created = result
    })
    await world.advance(1_000)
    expect(created).toBeUndefined()
    world.relay.write('a')
    await world.advance(500)
    expect(created).toBeUndefined()
    world.relay.write('a')
    await world.advance(500)
    expect(created).toMatchObject({
      ok: true,
      value: {
        streamSecret: 'secret-1',
        session: { channelId: 'a', rendition: 'copy', streamSecretHash: 'hash:secret-1' },
      },
    })
    expect([...world.sessions.rows.values()].map((session) => session.accountId)).toEqual(['leo'])
  })

  test('a disabled, missing or unknown channel has no session', async () => {
    const world = createLiveWorld()
    world.addChannel('off', { enabled: false })
    const gone = world.addChannel('gone')
    world.channels.channels.set('gone', { ...gone, missingSince: new Date() })
    for (const id of ['off', 'gone', 'nope']) {
      expect(await open(world, id)).toMatchObject({
        ok: false,
        error: { code: 'tv/channel_not_found' },
      })
    }
    expect(world.relay.runs).toEqual([])
    expect(world.sessions.rows.size).toBe(0)
  })

  test('an upstream that is not a stream URL is never opened (§29.4)', async () => {
    const world = createLiveWorld()
    for (const [id, url] of [
      ['relative', 'live/101.ts'],
      ['local', '/etc/passwd'],
      ['file', 'file:///etc/passwd'],
      ['windows', 'C:\\media\\a.ts'],
    ] as const) {
      const channel = world.addChannel(id)
      world.channels.channels.set(id, { ...channel, upstream: { url } })
      expect(await open(world, id)).toMatchObject({
        ok: false,
        error: { code: 'tv/stream_unavailable', context: { reason: 'invalid_upstream' } },
      })
    }
    expect(world.prober.calls).toEqual([])
    expect(world.relay.runs).toEqual([])
    expect(world.sessions.rows.size).toBe(0)
  })

  test('a stream that never gets ready leaves no session behind', async () => {
    const world = createLiveWorld()
    world.addChannel('a')
    world.prober.fail('http://provider.test/live/a.ts?token=secret')
    const opening = open(world, 'a')
    await world.advance(7_000)
    expect(await opening).toMatchObject({ ok: false, error: { code: 'tv/stream_unavailable' } })
    expect(world.sessions.rows.size).toBe(0)
    expect(world.streams.snapshot()).toEqual([])
  })

  test('the connection limit refuses the session', async () => {
    const world = createLiveWorld()
    world.addSource('source-1', 1)
    world.addChannel('a')
    world.addChannel('b')
    const first = open(world, 'a')
    await world.advance(0)
    world.relay.write('a', 2)
    await world.advance(500)
    expect((await first).ok).toBe(true)
    expect(await open(world, 'b', 'zoe')).toMatchObject({
      ok: false,
      error: { code: 'tv/connection_limit_reached' },
    })
    expect(world.sessions.rows.size).toBe(1)
  })

  test('a client that gives up while its stream starts leaves no session nor viewer behind', async () => {
    const world = createLiveWorld()
    world.addSource('source-1', 1)
    world.addChannel('a')
    world.addChannel('b')
    const zapping = new AbortController()
    let first: Awaited<ReturnType<typeof open>> | undefined
    void open(world, 'a', 'leo', zapping.signal).then((result) => {
      first = result
    })
    await world.advance(1_000)
    expect(world.sessions.rows.size).toBe(1)
    zapping.abort()
    await world.advance(0)
    expect(first).toMatchObject({
      ok: false,
      error: { code: 'tv/stream_unavailable', context: { reason: 'aborted' } },
    })
    expect(world.sessions.rows.size).toBe(0)
    expect(world.streams.snapshot()).toMatchObject([{ channelId: 'a', viewers: 0 }])

    // Zapping to another channel of a one-connection source: the abandoned stream is idle, so
    // it is stopped for the new one instead of refusing it.
    const second = open(world, 'b')
    await world.advance(0)
    expect(world.relay.current('a').stopped).toBe(true)
    world.relay.write('b', 2)
    await world.advance(500)
    expect((await second).ok).toBe(true)
    expect(world.streams.snapshot().map((stream) => stream.channelId)).toEqual(['b'])
  })
})

const interlaced = sampleProbe({ video: { codec: 'h264', fieldOrder: 'tt' } })
const upstreamA = 'http://provider.test/live/a.ts?token=secret'

const openWith = (
  world: ReturnType<typeof createLiveWorld>,
  channelId: string,
  client: ClientCapabilities,
  accountId = 'leo',
) =>
  world.createLiveSession({
    channelId,
    accountId,
    profileId: `${accountId}-profile`,
    authSessionId: `${accountId}-auth`,
    capabilities: client,
  })

describe('createLiveSession: the rendition (§29.4)', () => {
  test('a known interlaced probe gives a browser the compat stream at once', async () => {
    const world = createLiveWorld()
    world.addChannel('a')
    world.channels.probes.set('a', interlaced)
    const opening = open(world, 'a')
    await world.advance(0)
    world.relay.write('a', 2)
    await world.advance(500)
    world.relay.writeCompat('a', 2)
    await world.advance(500)
    const created = await opening
    expect(created).toMatchObject({ ok: true, value: { session: { rendition: 'compat' } } })
    if (!created.ok) return
    // Its capability URL serves the compat stream.
    const access = { sessionId: created.value.session.id, secret: created.value.streamSecret }
    expect(world.getLivePlaylist(access).ok).toBe(true)
    expect(world.getLiveFile({ ...access, name: 'seg-1-00001.m4s' })).toEqual({
      ok: true,
      value: '/live/a/compat/seg-1-00001.m4s',
    })
    expect(world.streams.snapshot()).toMatchObject([
      { rendition: 'copy', viewers: 1 },
      { rendition: 'compat', viewers: 1 },
    ])
    expect((await world.listLiveSessions()).map((session) => session.rendition)).toEqual(['compat'])
  })

  test('the mpv engine gets the copy, whatever the probe', async () => {
    const world = createLiveWorld()
    world.addChannel('a')
    world.channels.probes.set('a', interlaced)
    const opening = openWith(world, 'a', { ...capabilities, engine: 'mpv' })
    await world.advance(0)
    world.relay.write('a', 2)
    await world.advance(500)
    expect(await opening).toMatchObject({ ok: true, value: { session: { rendition: 'copy' } } })
    expect(world.relay.compatRuns).toEqual([])
    expect(world.transcodes.holders.size).toBe(0)
  })

  test('an unknown probe: the copy probes first, then the session moves to compat', async () => {
    const world = createLiveWorld()
    world.addChannel('a')
    world.prober.answer(upstreamA, interlaced)
    const opening = open(world, 'a')
    await world.advance(0)
    expect(world.sessions.rows.get('live-1')?.rendition).toBe('copy')
    world.relay.write('a', 2)
    await world.advance(500)
    expect(world.sessions.rows.get('live-1')?.rendition).toBe('compat')
    // The compat stream holds the copy: the session no longer watches it.
    expect(world.streams.snapshot()).toMatchObject([
      { rendition: 'copy', viewers: 1 },
      { rendition: 'compat', viewers: 1 },
    ])
    world.relay.writeCompat('a', 2)
    await world.advance(500)
    expect(await opening).toMatchObject({ ok: true, value: { session: { rendition: 'compat' } } })

    // Ending it leaves the compat stream, which lets its copy go idle too.
    const session = world.sessions.rows.get('live-1')
    if (session === undefined) throw new Error('no session')
    expect(world.stopLiveSession({ sessionId: session.id, accountId: 'leo' }).ok).toBe(true)
    expect(world.streams.snapshot()).toMatchObject([
      { rendition: 'copy', viewers: 0 },
      { rendition: 'compat', viewers: 0 },
    ])
  })

  test("the running copy's probe chooses when the cached one was dropped", async () => {
    const world = createLiveWorld()
    world.addChannel('a')
    world.prober.answer(upstreamA, interlaced)
    expect(world.join('mpv-viewer', 'a').ok).toBe(true)
    await world.advance(0)
    world.relay.write('a', 2)
    await world.advance(500)
    world.channels.probes.delete('a')
    const opening = open(world, 'a')
    await world.advance(0)
    world.relay.writeCompat('a', 2)
    await world.advance(500)
    expect(await opening).toMatchObject({ ok: true, value: { session: { rendition: 'compat' } } })
    expect(world.prober.calls).toHaveLength(1)
  })

  test('an unknown probe that turns out progressive H.264 stays on the copy', async () => {
    const world = createLiveWorld()
    world.addChannel('a')
    const opening = open(world, 'a')
    await world.advance(0)
    world.relay.write('a', 2)
    await world.advance(500)
    expect(await opening).toMatchObject({ ok: true, value: { session: { rendition: 'copy' } } })
    expect(world.relay.compatRuns).toEqual([])
  })

  test('no transcode slot: refused, nothing started, no session', async () => {
    const world = createLiveWorld({ transcodeLimit: 0 })
    world.addChannel('a')
    world.channels.probes.set('a', interlaced)
    expect(await open(world, 'a')).toMatchObject({
      ok: false,
      error: { code: 'playback/transcode_limit_reached' },
    })
    expect(world.relay.runs).toEqual([])
    expect(world.sessions.rows.size).toBe(0)

    // Probed only once the copy is ready: refused then, the copy left idle.
    world.addChannel('b')
    world.prober.answer('http://provider.test/live/b.ts?token=secret', interlaced)
    const opening = open(world, 'b')
    await world.advance(0)
    world.relay.write('b', 2)
    await world.advance(500)
    expect(await opening).toMatchObject({
      ok: false,
      error: { code: 'playback/transcode_limit_reached' },
    })
    expect(world.sessions.rows.size).toBe(0)
    expect(world.streams.snapshot()).toMatchObject([{ channelId: 'b', viewers: 0 }])
  })
})
