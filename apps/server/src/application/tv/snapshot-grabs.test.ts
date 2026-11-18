import { describe, expect, test } from 'bun:test'

import { createSnapshotWorld, type SnapshotWorld } from '../../../test/support/snapshot-world.ts'

const upstreamOf = (channelId: string) => `http://provider.test/live/${channelId}.ts?token=secret`

/** A source and its channels, in the page's order. */
const sourceWith = (
  world: SnapshotWorld,
  {
    id = 's',
    maxConnections,
    channels,
  }: { id?: string; maxConnections?: number; channels: string[] },
) => {
  world.addSource(id, maxConnections)
  for (const channel of channels) world.addChannel(channel, { sourceId: id })
}

const grabbed = (world: SnapshotWorld) =>
  world.snapshotter.grabs.map((grab) => /live\/(\w+)\.ts/u.exec(grab.upstream.url)?.[1])

/** Lets the spacing since the source's last connection pass (10 s exactly in this world). */
const spaced = (world: SnapshotWorld) => world.advance(10_000)

describe('background snapshot grabs (§29.4)', () => {
  test('one grab at a time per source, stored as the channel snapshot', async () => {
    const world = createSnapshotWorld()
    sourceWith(world, { channels: ['a', 'b'] })
    world.grabs.tick()
    expect(grabbed(world)).toEqual(['a'])
    expect(world.snapshotter.current().upstream.url).toBe(upstreamOf('a'))
    await spaced(world)
    world.grabs.tick()
    expect(grabbed(world)).toEqual(['a'])

    world.snapshotter.current().succeed()
    await world.grabs.idle()
    expect(world.files.written.has('tv/snapshots/a.webp')).toBe(true)
    expect(world.store.stateOf('a')).toMatchObject({ snapshotAt: world.clock.now(), failures: 0 })
    world.grabs.tick()
    expect(grabbed(world)).toEqual(['a', 'b'])
  })

  test('10 s between two connections to a source, a stream attempt included', async () => {
    const world = createSnapshotWorld()
    sourceWith(world, { channels: ['a', 'b', 'c'] })
    world.grabs.tick()
    world.snapshotter.current().succeed()
    await world.advance(9_000)
    world.grabs.tick()
    expect(grabbed(world)).toEqual(['a'])
    // A viewer's stream opens a connection: the spacing counts from it.
    expect(world.join('viewer', 'c').ok).toBe(true)
    await world.advance(1_000)
    world.grabs.tick()
    expect(grabbed(world)).toEqual(['a'])
    await spaced(world)
    world.grabs.tick()
    // `c` streams: it gives free snapshots and is never grabbed.
    expect(grabbed(world)).toEqual(['a', 'b'])
  })

  test('never the last free connection; a source without a limit always qualifies', async () => {
    const world = createSnapshotWorld()
    sourceWith(world, { id: 'two', maxConnections: 2, channels: ['a', 'b', 'c'] })
    expect(world.join('viewer', 'a').ok).toBe(true)
    await spaced(world)
    world.grabs.tick()
    // One of two in use: grabbing would take the last one.
    expect(grabbed(world)).toEqual([])

    world.addSource('free')
    world.addChannel('x', { sourceId: 'free' })
    world.grabs.tick()
    expect(grabbed(world)).toEqual(['x'])
  })

  test('off by default at one connection, on by default otherwise; the switch wins', async () => {
    const world = createSnapshotWorld()
    sourceWith(world, { id: 'one', maxConnections: 1, channels: ['a'] })
    world.grabs.tick()
    expect(grabbed(world)).toEqual([])
    world.setSnapshots('one', { snapshots: true })
    world.grabs.tick()
    // On, yet a single connection is never free twice over.
    expect(grabbed(world)).toEqual([])

    sourceWith(world, { id: 'many', maxConnections: 4, channels: ['m'] })
    world.setSnapshots('many', { snapshots: false })
    world.grabs.tick()
    expect(grabbed(world)).toEqual([])
    world.setSnapshots('many', { snapshots: true })
    world.grabs.tick()
    expect(grabbed(world)).toEqual(['m'])
  })

  test('a viewer evicts a grab before any idle stream, and its stream waits for it', async () => {
    const world = createSnapshotWorld()
    sourceWith(world, { maxConnections: 3, channels: ['a', 'b', 'c', 'd'] })
    expect(world.join('v1', 'a').ok).toBe(true)
    await spaced(world)
    world.grabs.tick()
    expect(grabbed(world)).toEqual(['b'])
    const grab = world.snapshotter.current()
    world.snapshotter.holdAborts()
    expect(world.join('v2', 'c').ok).toBe(true)
    await world.advance(0)
    expect(grab.signal.aborted).toBe(false)

    // The limit is reached (a, b's grab, c): the grab goes, not the streams.
    expect(world.join('v3', 'd').ok).toBe(true)
    expect(grab.signal.aborted).toBe(true)
    await world.advance(0)
    expect(world.relay.runsOf('d')).toHaveLength(0)
    world.snapshotter.releaseAborts()
    await world.advance(0)
    expect(world.relay.runsOf('d')).toHaveLength(1)
    await world.grabs.idle()
    // Stopped: neither a snapshot, a failure nor an attempt on the channel.
    expect(world.store.stateOf('b')).toEqual({ failures: 0 })
    expect(world.logs.lines.map((line) => line.message)).toContain('tv snapshot grab stopped')
  })

  test('a viewer of the grabbed channel stops its grab: one connection per channel', async () => {
    const world = createSnapshotWorld()
    sourceWith(world, { channels: ['a'] })
    world.grabs.tick()
    const grab = world.snapshotter.current()
    world.snapshotter.holdAborts()
    expect(world.join('viewer', 'a').ok).toBe(true)
    expect(grab.signal.aborted).toBe(true)
    await world.advance(0)
    expect(world.prober.calls).toEqual([])
    world.snapshotter.releaseAborts()
    await world.advance(0)
    expect(world.prober.calls).toEqual([upstreamOf('a')])
  })

  test('what a TV page shows comes first, then favourites', async () => {
    const world = createSnapshotWorld()
    sourceWith(world, { channels: ['a', 'b', 'c'] })
    world.store.favorites.add('b')
    world.visibleChannels.record({ profileId: 'p', channelIds: ['c'] })
    world.grabs.tick()
    world.snapshotter.current().succeed()
    await world.grabs.idle()
    await spaced(world)
    world.grabs.tick()
    expect(grabbed(world)).toEqual(['c', 'b'])
  })

  test('a failure backs the channel off; three refusals pause the source for an hour', async () => {
    const world = createSnapshotWorld()
    sourceWith(world, { channels: ['a', 'b', 'c', 'd', 'e'] })
    const failNext = async (reason: 'refused' | 'timeout' | 'failed') => {
      world.grabs.tick()
      world.snapshotter.current().fail(reason)
      await world.grabs.idle()
      await spaced(world)
    }
    await failNext('refused')
    expect(world.store.stateOf('a')).toMatchObject({ failures: 1 })
    await failNext('failed')
    await failNext('timeout')
    await failNext('refused')
    expect(grabbed(world)).toEqual(['a', 'b', 'c', 'd'])
    const paused = world.logs.lines.find((line) => line.message === 'tv snapshot grabs paused')
    expect(paused).toMatchObject({ level: 'warn', fields: { sourceId: 's', reason: 'refused' } })

    world.grabs.tick()
    expect(grabbed(world)).toHaveLength(4)
    await world.advance(60 * 60_000)
    world.grabs.tick()
    // An hour later, `a`'s back-off is over too: never snapshotted, first in the page's order.
    expect(grabbed(world)).toEqual(['a', 'b', 'c', 'd', 'a'])
  })

  test('the budget: at most the grabs per hour of the source', async () => {
    const world = createSnapshotWorld()
    sourceWith(world, { channels: ['a', 'b', 'c'] })
    world.setSnapshots('s', { snapshotGrabsPerHour: 2 })
    for (let i = 0; i < 2; i += 1) {
      world.grabs.tick()
      world.snapshotter.current().succeed()
      await world.grabs.idle()
      await spaced(world)
    }
    world.grabs.tick()
    expect(grabbed(world)).toEqual(['a', 'b'])
    await world.advance(60 * 60_000)
    world.grabs.tick()
    expect(grabbed(world)).toEqual(['a', 'b', 'c'])
  })

  test('turned off, a channel disabled or the module stopping ends the grab under way', async () => {
    const world = createSnapshotWorld()
    sourceWith(world, { channels: ['a', 'b'] })
    world.grabs.tick()
    world.setSnapshots('s', { snapshots: false })
    world.grabs.tick()
    expect(world.snapshotter.current().signal.aborted).toBe(true)
    await world.grabs.idle()

    world.setSnapshots('s', { snapshots: true })
    await spaced(world)
    world.grabs.tick()
    expect(grabbed(world)).toEqual(['a', 'a'])
    world.channels.repository.setChannelEnabled({ id: 'a', enabled: false })
    world.grabs.tick()
    expect(world.snapshotter.current().signal.aborted).toBe(true)
    await world.grabs.idle()

    await spaced(world)
    world.grabs.tick()
    expect(grabbed(world)).toEqual(['a', 'a', 'b'])
    await world.grabs.stop()
    expect(world.snapshotter.current().signal.aborted).toBe(true)
  })
})

describe('free snapshots from running streams (§29.4)', () => {
  test('at most every 5 minutes per channel, from its newest segment', async () => {
    const world = createSnapshotWorld()
    sourceWith(world, { channels: ['a'] })
    world.channels.repository.recordProbe({
      id: 'a',
      probe: {
        video: { codec: 'h264', fieldOrder: 'tt' },
        audio: [{ index: 1, codec: 'aac', audioDescription: false }],
      },
      at: world.clock.now(),
    })
    expect(world.join('viewer', 'a').ok).toBe(true)
    await world.advance(0)
    await world.play('a', 6_000)
    await world.streamSnapshots.idle()
    expect(world.snapshotter.fromRuns).toEqual([
      { channelId: 'a', run: 1, segment: 'seg-1-00000.m4s', interlaced: true },
    ])
    expect(world.files.written.has('tv/snapshots/a.webp')).toBe(true)
    expect(world.store.stateOf('a').snapshotAt).toBeDefined()

    await world.play('a', 4 * 60_000)
    expect(world.snapshotter.fromRuns).toHaveLength(1)
    await world.play('a', 62_000)
    expect(world.snapshotter.fromRuns).toHaveLength(2)
    // A free snapshot is not a grab: no attempt, no failure counted.
    expect(world.store.stateOf('a').attemptAt).toBeUndefined()
  })

  test('a failure is logged and tried again 5 minutes later', async () => {
    const world = createSnapshotWorld()
    sourceWith(world, { channels: ['a'] })
    world.snapshotter.failRuns(true)
    expect(world.join('viewer', 'a').ok).toBe(true)
    await world.advance(0)
    await world.play('a', 4_000)
    await world.streamSnapshots.idle()
    expect(world.snapshotter.fromRuns).toHaveLength(1)
    expect(world.files.written.size).toBe(0)
    await world.play('a', 60_000)
    expect(world.snapshotter.fromRuns).toHaveLength(1)
    world.snapshotter.failRuns(false)
    await world.play('a', 4 * 60_000 + 2_000)
    await world.streamSnapshots.idle()
    expect(world.snapshotter.fromRuns).toHaveLength(2)
    expect(world.files.written.size).toBe(1)
  })
})
