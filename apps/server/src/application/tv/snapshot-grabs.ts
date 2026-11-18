import type { Clock } from '../../core/clock.ts'
import type { Logger } from '../../core/logger.ts'
import type { TvChannelRepository } from '../../core/tv/channel.ts'
import { isRelayableUpstream, upstreamHostOf } from '../../core/tv/live.ts'
import type { TvLogoFiles } from '../../core/tv/logo.ts'
import type { TvSourceProvider } from '../../core/tv/provider.ts'
import { isInterlaced } from '../../core/tv/rendition.ts'
import {
  type TvGrabFailureReason,
  tvGrabFailureReasons,
  type TvSnapshotRepository,
  type TvSnapshotSource,
  type TvSnapshotter,
} from '../../core/tv/snapshot.ts'
import {
  type GrabPriorities,
  grabEnded,
  grabStarted,
  initialSourceGrabState,
  pickSnapshotChannel,
  type SourceGrabState,
  sourceGrabBlock,
  snapshotTimings,
} from '../../core/tv/snapshot-schedule.ts'
import type { TvSourceRepository } from '../../core/tv/source.ts'
import type { LiveStreams } from './live-streams.ts'
import { storeSnapshot } from './shared/store-snapshot.ts'
import type { VisibleChannels } from './visible-channels.ts'

type Deps = {
  snapshots: Pick<
    TvSnapshotRepository,
    'sources' | 'candidatesOf' | 'favoriteChannelIds' | 'recordSnapshot' | 'recordGrabFailure'
  >
  tvChannels: Pick<TvChannelRepository, 'findChannel' | 'probeOf'>
  tvSources: Pick<TvSourceRepository, 'findById'>
  provider: Pick<TvSourceProvider, 'upstreamOf'>
  streams: Pick<LiveStreams, 'openGrab' | 'stopGrab' | 'isStreaming' | 'lastConnectionAt'>
  snapshotter: Pick<TvSnapshotter, 'grab'>
  files: Pick<TvLogoFiles, 'write' | 'remove'>
  visibleChannels: Pick<VisibleChannels, 'visible'>
  clock: Clock
  logger: Logger
  /** A number in [0, 1): the spacing's random part. */
  random?: () => number
}

const reasonOf = (context: Readonly<Record<string, unknown>> | undefined): TvGrabFailureReason => {
  const reason = context?.['reason']
  return tvGrabFailureReasons.find((known) => known === reason) ?? 'failed'
}

/**
 * The background snapshot grabs (§29.4): `tick` (every 5 s) starts, for each source whose
 * snapshots are on, at most one grab of its most wanted due channel, within the source's budget,
 * spacing and free connections; a grab is a connection of the source in the relay's count, which
 * a viewer evicts. Holds each source's grab state (budget, spacing, refusals, pause) in memory.
 */
export const snapshotGrabsFactory = ({
  snapshots,
  tvChannels,
  tvSources,
  provider,
  streams,
  snapshotter,
  files,
  visibleChannels,
  clock,
  logger,
  random = Math.random,
}: Deps) => {
  const states = new Map<string, SourceGrabState>()
  /** The grab under way per source. */
  const running = new Map<string, { channelId: string; done: Promise<void> }>()

  const stateOf = (sourceId: string): SourceGrabState => {
    const state = states.get(sourceId) ?? initialSourceGrabState(random())
    states.set(sourceId, state)
    return state
  }

  /** Records a finished grab: the snapshot, or the channel's failure and the source's refusals. */
  const record = async ({
    source,
    channelId,
    host,
    result,
  }: {
    source: TvSnapshotSource
    channelId: string
    host: string
    result: Awaited<ReturnType<TvSnapshotter['grab']>>
  }): Promise<void> => {
    const at = clock.now()
    const nowMs = at.getTime()
    const fields = { channelId, sourceId: source.id, upstream: host }
    if (result.ok) {
      const stored = await storeSnapshot({
        files,
        snapshots,
        logger,
        channelId,
        bytes: result.value,
        at,
        grabbed: true,
      })
      states.set(source.id, grabEnded(stateOf(source.id), { ok: true }, nowMs).state)
      if (stored) logger.debug('tv snapshot grabbed', fields)
      return
    }
    const reason = reasonOf(result.error.context)
    snapshots.recordGrabFailure({ id: channelId, at })
    const ended = grabEnded(stateOf(source.id), { ok: false, reason }, nowMs)
    states.set(source.id, ended.state)
    const stderr = result.error.context?.['stderr']
    logger.info('tv snapshot grab failed', { ...fields, reason })
    if (typeof stderr === 'string')
      logger.debug('tv snapshot grab error lines', { ...fields, stderr })
    if (ended.paused)
      logger.warn('tv snapshot grabs paused', {
        sourceId: source.id,
        upstream: host,
        reason,
        pauseMs: snapshotTimings.pauseMs,
      })
  }

  /** Starts a grab of the channel when its source still gives it a connection. */
  const start = (source: TvSnapshotSource, channelId: string, nowMs: number): void => {
    const channel = tvChannels.findChannel(channelId)
    const settings = tvSources.findById(source.id)?.settings
    if (channel === undefined || settings === undefined) return
    const upstream = provider.upstreamOf({ settings, upstream: channel.upstream })
    if (upstream === undefined || !isRelayableUpstream(upstream.url)) {
      // Never a local path nor an unknown scheme (§29.4): backed off like a failure.
      snapshots.recordGrabFailure({ id: channelId, at: clock.now() })
      logger.warn('tv snapshot grab refused: the upstream is not a stream URL', { channelId })
      return
    }
    const opened = streams.openGrab({
      channelId,
      sourceId: source.id,
      maxConnections: source.maxConnections,
    })
    if (opened === undefined) return
    states.set(source.id, grabStarted(stateOf(source.id), nowMs, random()))
    const probe = tvChannels.probeOf(channelId)
    const host = upstreamHostOf(upstream.url)
    const done = (async () => {
      // Once ffmpeg is gone, the connection is the source's again.
      const result = await snapshotter
        .grab({
          upstream,
          ...(probe?.transport === undefined ? {} : { transport: probe.transport }),
          interlaced: probe !== undefined && isInterlaced(probe.video),
          signal: opened.signal,
        })
        .finally(opened.finish)
      if (opened.signal.aborted) {
        // Stopped (a viewer, the setting, shutdown): nothing recorded on the channel.
        states.set(source.id, grabEnded(stateOf(source.id), { stopped: true }, nowMs).state)
        return
      }
      await record({ source, channelId, host, result })
    })().finally(() => {
      running.delete(source.id)
    })
    running.set(source.id, { channelId, done })
  }

  return {
    /** Starts the grabs due now (the `tv-snapshots` task, every 5 s). */
    tick: (): void => {
      const nowMs = clock.now().getTime()
      const sources = snapshots.sources()
      const known = new Set(sources.map((source) => source.id))
      for (const [sourceId, grab] of running)
        if (!known.has(sourceId)) streams.stopGrab(grab.channelId, 'source_deleted')
      for (const sourceId of [...states.keys()])
        if (!known.has(sourceId) && !running.has(sourceId)) states.delete(sourceId)
      let priorities: GrabPriorities | undefined
      for (const source of sources) {
        const under = running.get(source.id)
        if (under !== undefined) {
          const channel = tvChannels.findChannel(under.channelId)
          if (!source.snapshots) streams.stopGrab(under.channelId, 'snapshots_off')
          else if (channel === undefined || !channel.enabled || channel.missingSince !== undefined)
            streams.stopGrab(under.channelId, 'channel_gone')
          continue
        }
        if (!source.snapshots) continue
        const block = sourceGrabBlock({
          state: stateOf(source.id),
          nowMs,
          grabsPerHour: source.grabsPerHour,
          lastConnectionAtMs: streams.lastConnectionAt(source.id),
        })
        if (block !== undefined) continue
        const candidates = snapshots.candidatesOf(source.id)
        if (candidates.length === 0) continue
        priorities ??= {
          visible: visibleChannels.visible(),
          favorites: snapshots.favoriteChannelIds(),
          streaming: (channelId) => streams.isStreaming(channelId),
        }
        const picked = pickSnapshotChannel({ candidates, nowMs, priorities })
        if (picked !== undefined) start(source, picked.id, nowMs)
      }
    },

    /** Stops the grabs under way (shutdown) and waits for their ffmpeg. */
    stop: async (): Promise<void> => {
      const under = [...running.values()]
      for (const { channelId } of under) streams.stopGrab(channelId, 'shutdown')
      await Promise.all(under.map(({ done }) => done))
    },

    /** Settles once the grabs under way are done: tests. */
    idle: async (): Promise<void> => {
      await Promise.all([...running.values()].map(({ done }) => done))
    },
  }
}

export type SnapshotGrabs = ReturnType<typeof snapshotGrabsFactory>
