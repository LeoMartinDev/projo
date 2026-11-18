import { appError, err, ok, type Result } from '@projo/shared'
import { DEFAULT_TV_SNAPSHOT_GRABS_PER_HOUR, tvSnapshotsEnabledOf } from '@projo/shared/api/tv'

import { snapshotGrabsFactory } from '../../src/application/tv/snapshot-grabs.ts'
import {
  type StreamSnapshots,
  streamSnapshotsFactory,
} from '../../src/application/tv/stream-snapshots.ts'
import { visibleChannelsFactory } from '../../src/application/tv/visible-channels.ts'
import type { TvChannel, TvUpstream } from '../../src/core/tv/channel.ts'
import type { LiveTransport } from '../../src/core/tv/live.ts'
import type { TvLogoFiles } from '../../src/core/tv/logo.ts'
import type {
  TvGrabFailureReason,
  TvSnapshotError,
  TvSnapshotRepository,
  TvSnapshotter,
} from '../../src/core/tv/snapshot.ts'
import { tvSnapshotPathOf } from '../../src/core/tv/snapshot.ts'
import type { TvSourceRepository } from '../../src/core/tv/source.ts'
import { createLiveWorld } from './live-world.ts'

/** The bytes a scripted snapshot gives. */
export const SNAPSHOT_BYTES = Uint8Array.from([
  0x52, 0x49, 0x46, 0x46, 1, 0, 0, 0, 0x57, 0x45, 0x42, 0x50,
])

type SnapshotState = { snapshotAt?: Date; attemptAt?: Date; failures: number; watchedAt?: Date }

/** The snapshots' columns (§29.4) over in-memory channels and sources; `favorites` settable. */
export const inMemoryTvSnapshots = (
  channels: ReadonlyMap<string, TvChannel>,
  sources: Pick<TvSourceRepository, 'list'>,
) => {
  const states = new Map<string, SnapshotState>()
  const favorites = new Set<string>()
  const stateOf = (id: string): SnapshotState => states.get(id) ?? { failures: 0 }
  const listed = (channel: TvChannel) => channel.enabled && channel.missingSince === undefined
  const repository: TvSnapshotRepository = {
    sources: () =>
      sources.list().map((source) => ({
        id: source.id,
        ...(source.maxConnections === undefined ? {} : { maxConnections: source.maxConnections }),
        snapshots: tvSnapshotsEnabledOf(source),
        grabsPerHour: source.snapshotGrabsPerHour ?? DEFAULT_TV_SNAPSHOT_GRABS_PER_HOUR,
      })),
    candidatesOf: (sourceId) =>
      [...channels.values()]
        .filter((channel) => channel.sourceId === sourceId && listed(channel))
        .sort((a, b) => a.position - b.position)
        .map((channel) => ({ id: channel.id, ...stateOf(channel.id) })),
    favoriteChannelIds: () => new Set(favorites),
    snapshotAtOf: (id) => stateOf(id).snapshotAt,
    recordSnapshot: ({ id, at, grabbed }) => {
      if (!channels.has(id)) return false
      states.set(id, {
        ...stateOf(id),
        snapshotAt: at,
        ...(grabbed ? { attemptAt: at, failures: 0 } : {}),
      })
      return true
    },
    recordGrabFailure: ({ id, at }) => {
      const state = stateOf(id)
      states.set(id, { ...state, attemptAt: at, failures: state.failures + 1 })
    },
    recordWatched: ({ id, at }) => {
      states.set(id, { ...stateOf(id), watchedAt: at })
    },
    freshSnapshots: (since) =>
      new Map(
        [...states.entries()].flatMap(([id, state]) => {
          const channel = channels.get(id)
          return channel !== undefined &&
            listed(channel) &&
            state.snapshotAt !== undefined &&
            state.snapshotAt >= since
            ? [[id, state.snapshotAt] as const]
            : []
        }),
      ),
    snapshotPathsOf: (sourceId) =>
      [...channels.values()]
        .filter((channel) => channel.sourceId === sourceId && stateOf(channel.id).snapshotAt)
        .map((channel) => tvSnapshotPathOf(channel.id)),
  }
  return { repository, states, favorites, stateOf }
}

/** Snapshot files in memory, by relative path. */
export const inMemorySnapshotFiles = () => {
  const written = new Map<string, Uint8Array>()
  const files: TvLogoFiles = {
    write: async ({ path, bytes }) => {
      written.set(path, bytes)
      return ok()
    },
    remove: async (path) => {
      written.delete(path)
    },
    absolutePath: (path) => `/data/images/${path}`,
  }
  return { files, written }
}

/** A grab under way: the test answers it; an abort settles it once `releaseAborts` allows. */
export type ScriptedGrab = {
  upstream: TvUpstream
  transport?: LiveTransport
  interlaced: boolean
  signal: AbortSignal
  succeed: () => void
  fail: (reason: TvGrabFailureReason) => void
  settled: boolean
}

const failure = (reason: string): Result<never, TvSnapshotError> =>
  err(appError('tv/snapshot_unavailable', 'scripted snapshot failure', { context: { reason } }))

/**
 * The snapshots' ffmpeg, scripted: `grabs` and `fromRuns` list the calls; a grab settles when
 * the test answers it or, once aborted, when aborts are released (`holdAborts()` keeps an aborted
 * grab's ffmpeg "alive" until `releaseAborts()`). `fromRun` answers at once (`failRuns` to fail).
 */
export const scriptedSnapshotter = () => {
  const grabs: ScriptedGrab[] = []
  const fromRuns: { channelId: string; run: number; segment: string; interlaced: boolean }[] = []
  let holding = false
  const heldAborts: (() => void)[] = []
  let runsFail = false
  const snapshotter: TvSnapshotter = {
    fromRun: async ({ channelId, run, segment, interlaced }) => {
      fromRuns.push({ channelId, run, segment, interlaced })
      return runsFail ? failure('failed') : ok(SNAPSHOT_BYTES)
    },
    grab: ({ upstream, transport, interlaced, signal }) =>
      new Promise((resolve) => {
        const grab: ScriptedGrab = {
          upstream,
          ...(transport === undefined ? {} : { transport }),
          interlaced,
          signal,
          settled: false,
          succeed: () => settle(ok(SNAPSHOT_BYTES)),
          fail: (reason) => settle(failure(reason)),
        }
        const settle = (result: Result<Uint8Array, TvSnapshotError>) => {
          if (grab.settled) return
          grab.settled = true
          resolve(result)
        }
        signal.addEventListener(
          'abort',
          () => {
            const gone = () => settle(failure('failed'))
            if (holding) heldAborts.push(gone)
            else gone()
          },
          { once: true },
        )
        grabs.push(grab)
      }),
  }
  return {
    snapshotter,
    grabs,
    fromRuns,
    current: (): ScriptedGrab => {
      const grab = grabs.at(-1)
      if (grab === undefined) throw new Error('no grab')
      return grab
    },
    holdAborts: () => {
      holding = true
    },
    releaseAborts: () => {
      holding = false
      for (const gone of heldAborts.splice(0)) gone()
    },
    failRuns: (fail: boolean) => {
      runsFail = fail
    },
  }
}

/**
 * The channel snapshots (§29.4) over the live world: the streams' free snapshots, the background
 * grabs and the pages' hints, a scripted snapshotter, files and columns in memory, no random
 * spacing (10 s exactly).
 */
export const createSnapshotWorld = () => {
  // The streams tell the free snapshots, built once the world gives their clock.
  const late: { streamSnapshots?: StreamSnapshots } = {}
  const world = createLiveWorld({
    onSegments: (input) => late.streamSnapshots?.segmentListed(input),
  })
  const snapshotter = scriptedSnapshotter()
  const store = inMemoryTvSnapshots(world.channels.channels, world.sources.repository)
  const files = inMemorySnapshotFiles()
  const logger = world.logs.logger
  const free = streamSnapshotsFactory({
    snapshotter: snapshotter.snapshotter,
    snapshots: store.repository,
    files: files.files,
    clock: world.clock,
    logger,
  })
  late.streamSnapshots = free
  const visibleChannels = visibleChannelsFactory({ clock: world.clock })
  const grabs = snapshotGrabsFactory({
    snapshots: store.repository,
    tvChannels: world.channels.repository,
    tvSources: world.sources.repository,
    provider: { upstreamOf: ({ upstream }) => upstream },
    streams: world.streams,
    snapshotter: snapshotter.snapshotter,
    files: files.files,
    visibleChannels,
    clock: world.clock,
    logger,
    random: () => 0,
  })
  /** Sets a source's snapshot settings (§29.4). */
  const setSnapshots = (
    sourceId: string,
    settings: { snapshots?: boolean; snapshotGrabsPerHour?: number },
  ) => {
    const source = world.sources.repository.findById(sourceId)
    if (source === undefined) throw new Error(`no source ${sourceId}`)
    world.sources.repository.save({ ...source, ...settings })
  }
  return {
    ...world,
    snapshotter,
    store,
    files,
    streamSnapshots: free,
    grabs,
    visibleChannels,
    setSnapshots,
  }
}

export type SnapshotWorld = ReturnType<typeof createSnapshotWorld>
