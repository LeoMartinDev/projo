import { describe, expect, test } from 'bun:test'

import { createLiveWorld, sampleProbe } from '../../../test/support/live-world.ts'

const copyOf = (channelId: string) => ({ channelId, rendition: 'copy' as const })

const upstreamOf = (channelId: string) => `http://provider.test/live/${channelId}.ts?token=secret`

/** A started channel whose run listed its first two segments: ready. */
const started = async (world: ReturnType<typeof createLiveWorld>, channelId = 'a') => {
  if (!world.channels.channels.has(channelId)) world.addChannel(channelId)
  expect(world.join(`viewer-${channelId}`, channelId).ok).toBe(true)
  await world.advance(0)
  world.relay.write(channelId, 2)
  await world.advance(500)
  expect(await world.streams.ready(copyOf(channelId))).toEqual({ ok: true, value: undefined })
}

describe('live streams (§29.4)', () => {
  test('the first viewer starts the stream: probed, one run, ready on its second segment', async () => {
    const world = createLiveWorld()
    world.addChannel('a')
    expect(world.join('s1', 'a').ok).toBe(true)
    let ready: unknown
    void world.streams.ready(copyOf('a')).then((result) => {
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
    expect(world.streams.playlist(copyOf('a'))).toMatchObject({
      ok: false,
      error: { code: 'tv/stream_unavailable' },
    })

    world.relay.write('a')
    await world.advance(500)
    // One segment: served to the stream's viewers, not enough to answer a new session.
    expect(ready).toBeUndefined()
    expect(world.streams.playlist(copyOf('a')).ok).toBe(true)
    world.relay.write('a')
    await world.advance(500)
    expect(ready).toEqual({ ok: true, value: undefined })
    const playlist = world.streams.playlist(copyOf('a'))
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
    expect(world.streams.file({ ...copyOf('a'), name: 'seg-1-00000.m4s' })).toEqual({
      ok: true,
      value: '/live/a/seg-1-00000.m4s',
    })
    expect(world.streams.file({ ...copyOf('a'), name: '../a/run-1.m3u8' })).toMatchObject({
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
      const playlist = world.streams.playlist(copyOf('a'))
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

    world.streams.leave({ sessionId: 'viewer-a', ...copyOf('a') })
    world.streams.leave({ sessionId: 's2', ...copyOf('a') })
    await world.play('a', 28_000)
    world.join('s3', 'a')
    await world.play('a', 40_000)
    expect(world.relay.current('a').stopped).toBe(false)

    world.streams.leave({ sessionId: 's3', ...copyOf('a') })
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
    expect(world.streams.isAvailable(copyOf('a'))).toBe(true)

    world.relay.current('a').exit()
    await world.advance(60_000)
    expect(world.relay.runs).toHaveLength(4)
    expect(world.streams.isAvailable(copyOf('a'))).toBe(false)
    expect(world.streams.playlist(copyOf('a'))).toMatchObject({
      ok: false,
      error: { code: 'tv/stream_unavailable' },
    })
    expect(await world.streams.ready(copyOf('a'))).toMatchObject({
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
    expect(world.streams.isAvailable(copyOf('a'))).toBe(true)
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
    void world.streams.ready(copyOf('a')).then((result) => {
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
    void world.streams.ready(copyOf('a')).then((result) => {
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
    expect(world.streams.isAvailable(copyOf('a'))).toBe(false)
    world.prober.restore(upstreamOf('a'))
    expect(world.join('s2', 'a').ok).toBe(true)
    await world.advance(0)
    expect(world.relay.runs).toHaveLength(1)
    world.relay.write('a', 2)
    await world.advance(500)
    expect(world.streams.isAvailable(copyOf('a'))).toBe(true)
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
    const joined = world.streams.playlist(copyOf('a'))
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
    const slid = world.streams.playlist(copyOf('a'))
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

    world.streams.leave({ sessionId: 'viewer-b', ...copyOf('b') })
    world.streams.leave({ sessionId: 'viewer-a', ...copyOf('a') })
    world.streams.leave({ sessionId: 's4', ...copyOf('a') })
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
    world.streams.leave({ sessionId: 'viewer-a', ...copyOf('a') })
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
    world.streams.leave({ sessionId: 'viewer-a', ...copyOf('a') })
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

    world.streams.leave({ sessionId: 's1', ...copyOf('a') })
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

const compatOf = (channelId: string) => ({ channelId, rendition: 'compat' as const })

const interlaced = sampleProbe({ video: { codec: 'h264', fieldOrder: 'tt' } })

/** Channel `channelId` (interlaced) with a ready compat stream watched by `viewer`. */
const compatStarted = async (
  world: ReturnType<typeof createLiveWorld>,
  viewer = 'c1',
  channelId = 'a',
) => {
  if (!world.channels.channels.has(channelId)) world.addChannel(channelId)
  world.prober.answer(upstreamOf(channelId), interlaced)
  expect(world.join(viewer, channelId, 'compat').ok).toBe(true)
  await world.advance(0)
  if (world.relay.runsOf(channelId).at(-1)?.segments.length === 0) {
    world.relay.write(channelId, 2)
    await world.advance(500)
  }
  world.relay.writeCompat(channelId, 2)
  await world.advance(500)
  expect(await world.streams.ready(compatOf(channelId))).toEqual({ ok: true, value: undefined })
}

describe('compat streams (§29.4)', () => {
  test('a compat stream takes a slot, starts the copy and is fed its newest segments', async () => {
    const world = createLiveWorld()
    world.addChannel('a')
    world.prober.answer(upstreamOf('a'), sampleProbe({ video: { codec: 'hevc' } }))
    expect(world.join('c1', 'a', 'compat').ok).toBe(true)
    expect([...world.transcodes.holders]).toEqual(['live:a'])
    await world.advance(0)
    // The compat run waits for the copy to be ready.
    expect(world.relay.runs).toHaveLength(1)
    expect(world.relay.compatRuns).toEqual([])
    world.relay.write('a', 3)
    await world.advance(500)
    const run = world.relay.currentCompat('a')
    expect(run.spec).toEqual({ channelId: 'a', run: 1, copyRun: 1, video: { codec: 'hevc' } })
    expect(run.fed).toEqual(['seg-1-00001.m4s', 'seg-1-00002.m4s'])
    world.relay.write('a')
    await world.advance(500)
    expect(run.fed.at(-1)).toBe('seg-1-00003.m4s')

    // A second compat viewer shares the stream: one run, one slot, one upstream.
    world.relay.writeCompat('a', 2)
    await world.advance(500)
    expect(world.join('c2', 'a', 'compat').ok).toBe(true)
    await world.advance(0)
    expect(await world.streams.ready(compatOf('a'))).toEqual({ ok: true, value: undefined })
    expect(world.relay.compatRuns).toHaveLength(1)
    expect(world.relay.runs).toHaveLength(1)
    expect(world.transcodes.holders.size).toBe(1)
    expect(world.streams.playlist(compatOf('a')).ok).toBe(true)
    expect(world.streams.file({ ...compatOf('a'), name: 'seg-1-00000.m4s' })).toEqual({
      ok: true,
      value: '/live/a/compat/seg-1-00000.m4s',
    })
    expect(
      world.streams.snapshot().map(({ rendition, viewers }) => ({ rendition, viewers })),
    ).toEqual([
      { rendition: 'copy', viewers: 1 },
      { rendition: 'compat', viewers: 2 },
    ])
  })

  test('the copy stays up while the compat stream has viewers; both stop once idle', async () => {
    const world = createLiveWorld()
    world.addChannel('a')
    expect(world.join('copy-viewer', 'a').ok).toBe(true)
    await compatStarted(world)
    world.streams.leave({ sessionId: 'copy-viewer', ...copyOf('a') })
    for (let elapsed = 0; elapsed < 60_000; elapsed += 2_000) {
      world.relay.write('a')
      world.relay.writeCompat('a')
      await world.advance(2_000)
    }
    expect(world.relay.current('a').stopped).toBe(false)
    expect(world.streams.isAvailable(copyOf('a'))).toBe(true)

    world.streams.leave({ sessionId: 'c1', ...compatOf('a') })
    await world.advance(29_000)
    expect(world.relay.currentCompat('a').stopped).toBe(false)
    // A viewer back within the delay keeps both.
    expect(world.join('c2', 'a', 'compat').ok).toBe(true)
    await world.advance(30_000)
    expect(world.relay.current('a').stopped).toBe(false)
    expect(world.transcodes.holders.size).toBe(1)

    world.streams.leave({ sessionId: 'c2', ...compatOf('a') })
    await world.advance(30_000)
    expect(world.relay.currentCompat('a').stopped).toBe(true)
    expect(world.relay.current('a').stopped).toBe(true)
    expect(world.relay.removedStreams.sort()).toEqual(['a', 'a/compat'])
    expect(world.transcodes.holders.size).toBe(0)
    expect(world.streams.snapshot()).toEqual([])
  })

  test('no slot free: refused before any copy starts; an idle compat stream gives its up', async () => {
    const world = createLiveWorld({ transcodeLimit: 1 })
    world.addChannel('b')
    await compatStarted(world)
    expect(world.join('c2', 'b', 'compat')).toMatchObject({
      ok: false,
      error: { code: 'playback/transcode_limit_reached', context: { limit: 1 } },
    })
    await world.advance(0)
    expect(world.relay.runsOf('b')).toEqual([])
    // The copy of a channel needs no slot.
    expect(world.join('s3', 'b').ok).toBe(true)

    // Idle, the compat stream of `a` stops at once for the one of `b`, not after its delay.
    world.streams.leave({ sessionId: 'c1', ...compatOf('a') })
    expect(world.join('c2', 'b', 'compat').ok).toBe(true)
    expect([...world.transcodes.holders]).toEqual(['live:b'])
    expect(world.transcodes.evicted).toEqual(['live:a'])
    await world.advance(0)
    expect(world.relay.currentCompat('a').stopped).toBe(true)
    expect(world.streams.isAvailable(compatOf('a'))).toBe(false)

    const none = createLiveWorld({ transcodeLimit: 0 })
    none.addChannel('a')
    expect(none.join('c1', 'a', 'compat')).toMatchObject({
      ok: false,
      error: { code: 'playback/transcode_limit_reached' },
    })
    expect(none.streams.snapshot()).toEqual([])
  })

  test('a new copy run starts a new compat run at once, not a failed attempt', async () => {
    const world = createLiveWorld()
    await compatStarted(world)
    world.relay.current('a').exit()
    await world.advance(1_000)
    expect(world.relay.runs).toHaveLength(2)
    expect(world.relay.compatRuns).toHaveLength(1)
    world.relay.write('a')
    await world.advance(500)
    expect(world.relay.compatRuns[0]?.stopped).toBe(true)
    const next = world.relay.currentCompat('a')
    expect(next.spec).toMatchObject({ run: 2, copyRun: 2 })
    expect(next.fed).toEqual(['seg-2-00000.m4s'])
    world.relay.writeCompat('a', 2)
    await world.advance(500)
    const playlist = world.streams.playlist(compatOf('a'))
    expect(playlist.ok && playlist.value).toContain('#EXT-X-DISCONTINUITY\n')
    const retries = world.logs.lines.filter((line) => line.message === 'live stream retrying')
    expect(retries.map((line) => line.fields['rendition'])).toEqual(['copy'])
  })

  test('a copy that fails fails its compat stream, gives the slot back, drops the probe', async () => {
    const failCopy = async (world: ReturnType<typeof createLiveWorld>) => {
      world.prober.fail(upstreamOf('a'))
      for (let attempt = 0; attempt < 4; attempt += 1) {
        world.relay.current('a').exit()
        await world.advance(5_000)
      }
    }
    const world = createLiveWorld()
    await compatStarted(world)
    expect(world.channels.probes.has('a')).toBe(true)
    await failCopy(world)
    expect(world.streams.isAvailable(copyOf('a'))).toBe(false)
    expect(world.streams.isAvailable(compatOf('a'))).toBe(false)
    expect(world.relay.currentCompat('a').stopped).toBe(true)
    expect(world.relay.removedStreams.sort()).toEqual(['a', 'a/compat'])
    expect(world.transcodes.holders.size).toBe(0)
    expect(world.channels.probes.has('a')).toBe(false)
    // Failed, not forgotten: its viewer stays its own, so a new start counts it again.
    expect(world.streams.snapshot()).toEqual([
      expect.objectContaining({ rendition: 'compat', viewers: 1, failed: true }),
    ])
    expect(world.streams.playlist(compatOf('a'))).toMatchObject({
      ok: false,
      error: { code: 'tv/stream_unavailable' },
    })

    world.prober.answer(upstreamOf('a'), interlaced)
    expect(world.join('c2', 'a', 'compat').ok).toBe(true)
    await world.advance(0)
    world.relay.write('a', 2)
    await world.advance(500)
    expect(world.relay.currentCompat('a').stopped).toBe(false)
    expect(world.streams.isAvailable(compatOf('a'))).toBe(true)
    expect(world.streams.snapshot()).toMatchObject([
      { rendition: 'compat', viewers: 2, failed: false },
      { rendition: 'copy', viewers: 1 },
    ])

    // Its last viewer leaving, a failed compat stream is forgotten.
    const again = createLiveWorld()
    await compatStarted(again)
    await failCopy(again)
    again.streams.leave({ sessionId: 'c1', ...compatOf('a') })
    expect(again.streams.snapshot()).toEqual([])
  })

  test('a compat stream that fails gives its slot and the copy back', async () => {
    const world = createLiveWorld()
    world.addChannel('a')
    expect(world.join('copy-viewer', 'a').ok).toBe(true)
    await compatStarted(world)
    for (let attempt = 0; attempt < 4; attempt += 1) {
      world.relay.currentCompat('a').exit()
      await world.advance(5_000)
    }
    expect(world.relay.compatRuns).toHaveLength(4)
    expect(world.streams.isAvailable(compatOf('a'))).toBe(false)
    expect(world.transcodes.holders.size).toBe(0)
    expect(world.streams.isAvailable(copyOf('a'))).toBe(true)
    expect(world.streams.snapshot().find((s) => s.rendition === 'copy')?.viewers).toBe(1)

    // A new compat viewer starts it afresh.
    expect(world.join('c2', 'a', 'compat').ok).toBe(true)
    await world.advance(0)
    expect(world.relay.compatRuns).toHaveLength(5)
  })

  test('an idle compat stream does not keep its copy from being evicted', async () => {
    const world = createLiveWorld()
    world.addSource('source-1', 1)
    world.addChannel('b')
    await compatStarted(world)
    world.streams.leave({ sessionId: 'c1', ...compatOf('a') })
    expect(world.join('s2', 'b').ok).toBe(true)
    await world.advance(0)
    expect(world.relay.current('a').stopped).toBe(true)
    expect(world.relay.currentCompat('a').stopped).toBe(true)
    expect(world.transcodes.holders.size).toBe(0)
    expect(world.relay.runsOf('b')).toHaveLength(1)
  })

  test('zapping across interlaced channels: idle compat streams give their slots up', async () => {
    const world = createLiveWorld()
    await compatStarted(world, 'zap', 'a')
    world.streams.leave({ sessionId: 'zap', ...compatOf('a') })
    await world.advance(1_000)
    await compatStarted(world, 'zap', 'b')
    world.streams.leave({ sessionId: 'zap', ...compatOf('b') })
    await world.advance(1_000)
    // Two idle compat streams hold both slots: the one idle the longest gives its up.
    await compatStarted(world, 'zap', 'c')
    expect(world.transcodes.evicted).toEqual(['live:a'])
    expect([...world.transcodes.holders].sort()).toEqual(['live:b', 'live:c'])
    expect(world.relay.currentCompat('a').stopped).toBe(true)
    expect(world.relay.currentCompat('b').stopped).toBe(false)
    // Zapping back to `b` within its idle delay is instant: its stream is still up.
    expect(world.join('zap-back', 'b', 'compat').ok).toBe(true)
    expect(world.relay.compatRunsOf('b')).toHaveLength(1)
  })

  test('a playback transcode takes the slot of an idle compat stream, not of a watched one', async () => {
    const world = createLiveWorld({ transcodeLimit: 1 })
    await compatStarted(world)
    expect(world.transcodes.slots.admitPlayback(0)).toMatchObject({
      ok: false,
      error: { code: 'playback/transcode_limit_reached', context: { limit: 1 } },
    })
    expect(world.relay.currentCompat('a').stopped).toBe(false)

    world.streams.leave({ sessionId: 'c1', ...compatOf('a') })
    expect(world.transcodes.slots.admitPlayback(0).ok).toBe(true)
    await world.advance(0)
    expect(world.transcodes.evicted).toEqual(['live:a'])
    expect(world.transcodes.holders.size).toBe(0)
    expect(world.relay.currentCompat('a').stopped).toBe(true)
    expect(world.relay.removedStreams).toContain('a/compat')
  })

  test('a compat run more than 3 segments behind its input starts again on the newest', async () => {
    const world = createLiveWorld()
    await compatStarted(world)
    const late = world.relay.currentCompat('a')
    late.backlog = 3
    world.relay.write('a')
    await world.advance(500)
    expect(world.relay.compatRuns).toHaveLength(1)

    late.backlog = 4
    world.relay.write('a')
    await world.advance(500)
    expect(late.stopped).toBe(true)
    const next = world.relay.currentCompat('a')
    expect(next.spec).toMatchObject({ run: 2, copyRun: 1 })
    expect(next.fed).toEqual(['seg-1-00002.m4s', 'seg-1-00003.m4s'])
    expect(
      world.logs.lines.filter(
        (line) => line.message === 'live compat stream behind its input, starting it again',
      ),
    ).toEqual([expect.objectContaining({ level: 'warn' })])
    // Not a failed attempt: no retry; the stream goes on after a discontinuity.
    expect(world.logs.lines.map((line) => line.message)).not.toContain('live stream retrying')
    world.relay.writeCompat('a', 2)
    await world.advance(500)
    const playlist = world.streams.playlist(compatOf('a'))
    expect(playlist.ok && playlist.value).toContain('#EXT-X-DISCONTINUITY\n')
  })

  test('a compat run behind before listing anything is left to the stall rule', async () => {
    const world = createLiveWorld()
    world.addChannel('a')
    world.prober.answer(upstreamOf('a'), interlaced)
    world.join('c1', 'a', 'compat')
    await world.advance(0)
    world.relay.write('a', 2)
    await world.advance(500)
    world.relay.currentCompat('a').backlog = 10
    world.relay.write('a')
    await world.advance(500)
    expect(world.relay.compatRuns).toHaveLength(1)
    await world.play('a', 15_000)
    expect(world.relay.compatRuns[0]?.stopped).toBe(true)
    const retries = world.logs.lines.filter((line) => line.message === 'live stream retrying')
    expect(retries.map((line) => line.fields['rendition'])).toEqual(['compat'])
  })

  test('a new compat stream waits for the previous one of its channel to be gone', async () => {
    const world = createLiveWorld()
    world.addChannel('a')
    expect(world.join('copy-viewer', 'a').ok).toBe(true)
    await compatStarted(world)
    world.relay.holdStops()
    world.streams.leave({ sessionId: 'c1', ...compatOf('a') })
    await world.advance(30_000)
    expect(world.relay.currentCompat('a').stopped).toBe(true)
    expect(world.join('c2', 'a', 'compat').ok).toBe(true)
    world.relay.write('a', 3)
    await world.advance(5_000)
    // Its folder is the same: the old run's stop would delete what the new one writes.
    expect(world.relay.compatRuns).toHaveLength(1)

    world.relay.currentCompat('a').exit()
    await world.advance(0)
    expect(world.relay.journal.filter((entry) => entry.includes('compat'))).toEqual([
      'start a/compat:1',
      'exit a/compat:1',
      'remove a/compat',
      'start a/compat:1',
    ])
  })
})
