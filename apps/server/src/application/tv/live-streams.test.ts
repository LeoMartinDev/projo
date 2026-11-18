import { describe, expect, test } from 'bun:test'

import { createLiveWorld, sampleProbe } from '../../../test/support/live-world.ts'

const upstreamOf = (channelId: string) => `http://provider.test/live/${channelId}.ts?token=secret`

/** A started channel whose run listed its first two segments: ready. */
const started = async (world: ReturnType<typeof createLiveWorld>, channelId = 'a') => {
  if (!world.channels.channels.has(channelId)) world.addChannel(channelId)
  expect(world.join(`viewer-${channelId}`, channelId).ok).toBe(true)
  await world.advance(0)
  world.relay.write(channelId, 2)
  await world.advance(500)
  expect(await world.streams.ready(channelId)).toEqual({ ok: true, value: undefined })
}

describe('live streams (§29.4)', () => {
  test('the first viewer starts the stream: probed, one run, ready on its second segment', async () => {
    const world = createLiveWorld()
    world.addChannel('a')
    expect(world.join('s1', 'a').ok).toBe(true)
    let ready: unknown
    void world.streams.ready('a').then((result) => {
      ready = result
    })
    await world.advance(0)
    expect(world.prober.calls).toEqual([upstreamOf('a')])
    expect(world.relay.runs.map((run) => run.spec)).toEqual([
      {
        channelId: 'a',
        run: 1,
        upstream: { url: upstreamOf('a') },
        videoCodec: 'h264',
        audio: { index: 1, copy: true },
      },
    ])
    await world.advance(2_000)
    expect(ready).toBeUndefined()
    expect(world.streams.playlist('a')).toMatchObject({
      ok: false,
      error: { code: 'tv/stream_unavailable' },
    })

    world.relay.write('a')
    await world.advance(500)
    // One segment: served to the stream's viewers, not enough to answer a new session.
    expect(ready).toBeUndefined()
    expect(world.streams.playlist('a').ok).toBe(true)
    world.relay.write('a')
    await world.advance(500)
    expect(ready).toEqual({ ok: true, value: undefined })
    const playlist = world.streams.playlist('a')
    expect(playlist.ok && playlist.value).toBe(
      [
        '#EXTM3U',
        '#EXT-X-VERSION:7',
        '#EXT-X-TARGETDURATION:4',
        '#EXT-X-MEDIA-SEQUENCE:0',
        '#EXT-X-DISCONTINUITY-SEQUENCE:0',
        '#EXT-X-INDEPENDENT-SEGMENTS',
        '#EXT-X-MAP:URI="init-1.mp4"',
        '#EXTINF:2.000,',
        'seg-1-00000.m4s',
        '#EXTINF:2.000,',
        'seg-1-00001.m4s',
        '',
      ].join('\n'),
    )
    expect(world.channels.probes.get('a')).toEqual(sampleProbe())
    expect(world.streams.file({ channelId: 'a', name: 'seg-1-00000.m4s' })).toEqual({
      ok: true,
      value: '/live/a/seg-1-00000.m4s',
    })
    expect(world.streams.file({ channelId: 'a', name: '../a/run-1.m3u8' })).toMatchObject({
      ok: false,
      error: { code: 'tv/segment_not_found' },
    })
  })

  test('the target duration is pinned by the first segment and never changes', async () => {
    const world = createLiveWorld()
    world.addChannel('a')
    world.join('s1', 'a')
    await world.advance(0)
    world.relay.write('a', 2, 2.6)
    await world.advance(500)
    const targetOf = () => {
      const playlist = world.streams.playlist('a')
      return playlist.ok ? /#EXT-X-TARGETDURATION:(\d+)/u.exec(playlist.value)?.[1] : undefined
    }
    expect(targetOf()).toBe('5')
    // Longer than the target: served as it is, the target kept, logged once.
    world.relay.write('a', 2, 6)
    await world.advance(500)
    world.relay.current('a').exit()
    await world.advance(1_000)
    world.relay.write('a', 2, 1)
    await world.advance(500)
    expect(targetOf()).toBe('5')
    expect(
      world.logs.lines.filter(
        (line) => line.message === 'live segment longer than the target duration',
      ),
    ).toHaveLength(1)
  })

  test('the relayed audio is the first track that is not an audio description', async () => {
    const world = createLiveWorld()
    world.addChannel('a')
    world.prober.answer(
      upstreamOf('a'),
      sampleProbe({
        audio: [
          { index: 1, codec: 'aac', audioDescription: true },
          { index: 2, codec: 'mp2', audioDescription: false },
        ],
      }),
    )
    world.join('s1', 'a')
    await world.advance(0)
    expect(world.relay.current('a').spec.audio).toEqual({ index: 2, copy: false })
  })

  test('a cached probe is used, and dropped by a run that lists nothing', async () => {
    const world = createLiveWorld()
    world.addChannel('a')
    world.channels.probes.set('a', sampleProbe({ audio: [] }))
    world.join('s1', 'a')
    await world.advance(0)
    expect(world.prober.calls).toEqual([])
    expect(world.relay.current('a').spec.audio).toBeUndefined()
    world.relay.current('a').exit()
    await world.advance(0)
    expect(world.channels.probes.has('a')).toBe(false)
    await world.advance(1_000)
    expect(world.prober.calls).toEqual([upstreamOf('a')])
    expect(world.relay.current('a').spec.audio).toEqual({ index: 1, copy: true })
  })

  test('viewers share the stream; it stops 30 s after the last one leaves', async () => {
    const world = createLiveWorld()
    await started(world)
    world.join('s2', 'a')
    expect(world.relay.runs).toHaveLength(1)
    expect(world.streams.snapshot()).toMatchObject([{ channelId: 'a', viewers: 2 }])

    world.streams.leave({ sessionId: 'viewer-a', channelId: 'a' })
    world.streams.leave({ sessionId: 's2', channelId: 'a' })
    await world.play('a', 28_000)
    world.join('s3', 'a')
    await world.play('a', 40_000)
    expect(world.relay.current('a').stopped).toBe(false)

    world.streams.leave({ sessionId: 's3', channelId: 'a' })
    await world.play('a', 28_000)
    expect(world.relay.current('a').stopped).toBe(false)
    await world.advance(2_000)
    expect(world.relay.current('a').stopped).toBe(true)
    expect(world.relay.removedStreams).toEqual(['a'])
    expect(world.streams.snapshot()).toEqual([])
    expect(world.relay.runs).toHaveLength(1)
  })

  test('a run that ends is started again after 1, 2 then 4 s; the fourth failure ends it', async () => {
    const world = createLiveWorld()
    await started(world)
    world.relay.current('a').exit()
    await world.advance(999)
    expect(world.relay.runs).toHaveLength(1)
    await world.advance(1)
    // The first run listed a segment: its probe is kept.
    expect(world.relay.runs).toHaveLength(2)
    expect(world.prober.calls).toHaveLength(1)

    world.relay.current('a').exit()
    await world.advance(1_999)
    expect(world.relay.runs).toHaveLength(2)
    await world.advance(1)
    expect(world.relay.runs).toHaveLength(3)
    expect(world.prober.calls).toHaveLength(2)

    world.relay.current('a').exit()
    await world.advance(4_000)
    expect(world.relay.runs).toHaveLength(4)
    expect(world.streams.isAvailable('a')).toBe(true)

    world.relay.current('a').exit()
    await world.advance(60_000)
    expect(world.relay.runs).toHaveLength(4)
    expect(world.streams.isAvailable('a')).toBe(false)
    expect(world.streams.playlist('a')).toMatchObject({
      ok: false,
      error: { code: 'tv/stream_unavailable' },
    })
    expect(await world.streams.ready('a')).toMatchObject({
      ok: false,
      error: { code: 'tv/stream_unavailable' },
    })
    expect(world.relay.removedStreams).toEqual(['a'])
    expect(world.logs.lines.map((line) => line.message)).toContain('live stream unavailable')
    expect(JSON.stringify(world.logs.lines)).not.toContain('secret')
  })

  test('a run that lists a segment resets the count of failures', async () => {
    const world = createLiveWorld()
    await started(world)
    for (let i = 0; i < 5; i += 1) {
      world.relay.current('a').exit()
      await world.advance(1_000)
      world.relay.write('a')
      await world.advance(500)
    }
    expect(world.relay.runs).toHaveLength(6)
    expect(world.streams.isAvailable('a')).toBe(true)
  })

  test('a run that lists nothing new for 15 s is killed, a failed attempt', async () => {
    const world = createLiveWorld()
    await started(world)
    await world.advance(14_500)
    expect(world.relay.current('a').stopped).toBe(false)
    await world.advance(500)
    expect(world.relay.runs[0]?.stopped).toBe(true)
    await world.advance(1_000)
    expect(world.relay.runs).toHaveLength(2)
  })

  test('a probe that keeps failing makes the session wait in vain', async () => {
    const world = createLiveWorld()
    world.addChannel('a')
    world.prober.fail(upstreamOf('a'))
    world.join('s1', 'a')
    let ready: unknown
    void world.streams.ready('a').then((result) => {
      ready = result
    })
    await world.advance(6_999)
    expect(ready).toBeUndefined()
    await world.advance(1)
    expect(ready).toMatchObject({ ok: false, error: { code: 'tv/stream_unavailable' } })
    expect(world.prober.calls).toHaveLength(4)
    expect(world.relay.runs).toEqual([])
  })

  test('readiness gives up after 30 s', async () => {
    const world = createLiveWorld()
    world.addChannel('a')
    world.join('s1', 'a')
    let ready: unknown
    void world.streams.ready('a').then((result) => {
      ready = result
    })
    await world.advance(29_999)
    expect(ready).toBeUndefined()
    await world.advance(1)
    expect(ready).toMatchObject({
      ok: false,
      error: { code: 'tv/stream_unavailable', context: { reason: 'timeout' } },
    })
  })

  test('a failed channel starts afresh for a new session', async () => {
    const world = createLiveWorld()
    world.addChannel('a')
    world.prober.fail(upstreamOf('a'))
    world.join('s1', 'a')
    await world.advance(7_000)
    expect(world.streams.isAvailable('a')).toBe(false)
    world.prober.restore(upstreamOf('a'))
    expect(world.join('s2', 'a').ok).toBe(true)
    await world.advance(0)
    expect(world.relay.runs).toHaveLength(1)
    world.relay.write('a', 2)
    await world.advance(500)
    expect(world.streams.isAvailable('a')).toBe(true)
    expect(world.streams.snapshot()).toMatchObject([{ viewers: 2, failed: false }])
  })

  test('the window slides over 30 s; a run following another is a discontinuity', async () => {
    const world = createLiveWorld()
    await started(world)
    world.relay.write('a', 2)
    await world.advance(500)
    world.relay.current('a').exit()
    await world.advance(1_000)
    world.relay.write('a')
    await world.advance(500)
    const joined = world.streams.playlist('a')
    expect(joined.ok && joined.value.split('\n').slice(6)).toEqual([
      '#EXT-X-MAP:URI="init-1.mp4"',
      '#EXTINF:2.000,',
      'seg-1-00000.m4s',
      '#EXTINF:2.000,',
      'seg-1-00001.m4s',
      '#EXTINF:2.000,',
      'seg-1-00002.m4s',
      '#EXTINF:2.000,',
      'seg-1-00003.m4s',
      '#EXT-X-DISCONTINUITY',
      '#EXT-X-MAP:URI="init-2.mp4"',
      '#EXTINF:2.000,',
      'seg-2-00000.m4s',
      '',
    ])

    world.relay.write('a', 15)
    await world.advance(500)
    const slid = world.streams.playlist('a')
    expect(slid.ok && slid.value).toContain('#EXT-X-MEDIA-SEQUENCE:5')
    expect(slid.ok && slid.value).toContain('#EXT-X-DISCONTINUITY-SEQUENCE:1')
    expect(slid.ok && slid.value).not.toContain('init-1.mp4')
    expect(slid.ok && slid.value.match(/\.m4s/gu)?.length).toBe(15)
    expect(world.relay.removedRuns).toEqual(['a:1'])
  })

  test('the connection limit stops idle streams, longest idle first, else refuses', async () => {
    const world = createLiveWorld()
    world.addSource('source-1', 2)
    for (const id of ['a', 'b', 'c']) world.addChannel(id)
    await started(world, 'a')
    await started(world, 'b')
    expect(world.join('s3', 'c')).toMatchObject({
      ok: false,
      error: { code: 'tv/connection_limit_reached', context: { maxConnections: 2 } },
    })
    // Another viewer of a running channel needs no connection.
    expect(world.join('s4', 'a').ok).toBe(true)

    world.streams.leave({ sessionId: 'viewer-b', channelId: 'b' })
    world.streams.leave({ sessionId: 'viewer-a', channelId: 'a' })
    world.streams.leave({ sessionId: 's4', channelId: 'a' })
    expect(world.join('s3', 'c').ok).toBe(true)
    await world.advance(0)
    expect(world.relay.current('b').stopped).toBe(true)
    expect(world.relay.current('a').stopped).toBe(false)
    expect(world.relay.current('c').spec.run).toBe(1)
    expect(world.streams.snapshot().map((stream) => stream.channelId)).toEqual(['a', 'c'])
  })

  test('failed streams hold no connection; a source without a limit has none', async () => {
    const world = createLiveWorld()
    world.addSource('source-1', 1)
    world.addChannel('a')
    world.addChannel('b')
    world.prober.fail(upstreamOf('a'))
    world.join('s1', 'a')
    await world.advance(7_000)
    expect(world.join('s2', 'b').ok).toBe(true)

    world.addSource('open')
    for (const id of ['x', 'y', 'z']) {
      world.addChannel(id, { sourceId: 'open' })
      expect(world.join(`viewer-${id}`, id).ok).toBe(true)
    }
  })

  test('a channel joined again while it stops waits for its old run to be gone', async () => {
    const world = createLiveWorld()
    await started(world)
    world.relay.holdStops()
    world.streams.leave({ sessionId: 'viewer-a', channelId: 'a' })
    await world.advance(30_000)
    expect(world.relay.current('a').stopped).toBe(true)
    expect(world.join('s2', 'a').ok).toBe(true)
    await world.advance(5_000)
    expect(world.relay.runs).toHaveLength(1)

    world.relay.current('a').exit()
    await world.advance(0)
    expect(world.relay.journal).toEqual(['start a:1', 'exit a:1', 'remove a', 'start a:1'])
  })

  test("an evicted stream's run is gone before the next channel of its source starts", async () => {
    const world = createLiveWorld()
    world.addSource('source-1', 1)
    await started(world, 'a')
    world.relay.holdStops()
    world.streams.leave({ sessionId: 'viewer-a', channelId: 'a' })
    world.addChannel('b')
    expect(world.join('s2', 'b').ok).toBe(true)
    await world.advance(5_000)
    expect(world.relay.current('a').stopped).toBe(true)
    expect(world.relay.runsOf('b')).toEqual([])

    world.relay.current('a').exit()
    await world.advance(0)
    expect(world.relay.journal).toEqual(['start a:1', 'exit a:1', 'remove a', 'start b:1'])
  })

  test('a stop during the probe aborts ffprobe and waits for it to be gone', async () => {
    const world = createLiveWorld()
    world.addSource('source-1', 1)
    world.addChannel('a')
    world.addChannel('b')
    world.prober.hold(upstreamOf('a'))
    world.join('s1', 'a')
    await world.advance(0)
    const [probe] = world.prober.held
    expect(probe?.signal.aborted).toBe(false)

    world.streams.leave({ sessionId: 's1', channelId: 'a' })
    await world.advance(30_000)
    expect(probe?.signal.aborted).toBe(true)
    expect(world.streams.snapshot()).toEqual([])
    // ffprobe still holds the upstream: the source's next stream waits for it.
    expect(world.join('s2', 'b').ok).toBe(true)
    await world.advance(5_000)
    expect(world.relay.runs).toEqual([])
    expect(world.relay.removedStreams).toEqual([])

    probe?.settle()
    await world.advance(0)
    expect(world.relay.journal).toEqual(['remove a', 'start b:1'])
    expect(world.relay.runsOf('a')).toEqual([])
    expect(world.channels.probes.has('a')).toBe(false)
  })

  test('stopping every stream waits for a probe under way', async () => {
    const world = createLiveWorld()
    world.addChannel('a')
    world.prober.hold(upstreamOf('a'))
    world.join('s1', 'a')
    await world.advance(0)
    let stopped = false
    void world.streams.stopAll().then(() => {
      stopped = true
    })
    await world.advance(0)
    expect(world.prober.held[0]?.signal.aborted).toBe(true)
    expect(stopped).toBe(false)
    world.prober.held[0]?.settle()
    await world.advance(0)
    expect(stopped).toBe(true)
    expect(world.relay.runs).toEqual([])
  })

  test('stopping every stream kills their runs', async () => {
    const world = createLiveWorld()
    await started(world, 'a')
    await started(world, 'b')
    await world.streams.stopAll()
    expect(world.relay.runs.every((run) => run.stopped)).toBe(true)
    expect(world.streams.snapshot()).toEqual([])
    expect(world.relay.removedStreams.sort()).toEqual(['a', 'b'])
  })
})
