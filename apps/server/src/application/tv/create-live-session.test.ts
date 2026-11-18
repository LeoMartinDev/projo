import { describe, expect, test } from 'bun:test'

import type { ClientCapabilities } from '@projo/shared/api/playback'

import { createLiveWorld } from '../../../test/support/live-world.ts'

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
