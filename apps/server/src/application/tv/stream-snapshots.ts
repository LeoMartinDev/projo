import type { Clock } from '../../core/clock.ts'
import type { Logger } from '../../core/logger.ts'
import type { TvChannelProbe } from '../../core/tv/live.ts'
import type { TvLogoFiles } from '../../core/tv/logo.ts'
import { isInterlaced } from '../../core/tv/rendition.ts'
import type { TvSnapshotRepository, TvSnapshotter } from '../../core/tv/snapshot.ts'
import { isFreeSnapshotDue, snapshotTimings } from '../../core/tv/snapshot-schedule.ts'
import { storeSnapshot } from './shared/store-snapshot.ts'

type Deps = {
  snapshotter: Pick<TvSnapshotter, 'fromRun'>
  snapshots: Pick<TvSnapshotRepository, 'snapshotAtOf' | 'recordSnapshot'>
  files: Pick<TvLogoFiles, 'write' | 'remove'>
  clock: Clock
  logger: Logger
  /** Snapshots made at once, in all. */
  concurrency?: number
}

/**
 * The free snapshots (§29.4): a running `copy` stream's poll tells each new segment; at most
 * every 5 minutes per channel, a picture is made from its run's init and newest segment, never
 * awaited by the relay, one at a time per channel and two at a time in all. Holds the last try
 * per channel and the snapshots under way in memory.
 */
export const streamSnapshotsFactory = ({
  snapshotter,
  snapshots,
  files,
  clock,
  logger,
  concurrency = snapshotTimings.freeConcurrency,
}: Deps) => {
  /** The newest of the channel's snapshot and of its last try from a stream, in ms. */
  const lastTried = new Map<string, number>()
  const running = new Map<string, { controller: AbortController; done: Promise<void> }>()
  let stopped = false

  const take = async (
    input: { channelId: string; run: number; segment: string; interlaced: boolean },
    signal: AbortSignal,
  ): Promise<void> => {
    const made = await snapshotter.fromRun({ ...input, signal })
    if (signal.aborted) return
    if (!made.ok) {
      logger.debug('tv snapshot from a stream not taken', {
        channelId: input.channelId,
        code: made.error.code,
        ...(made.error.context === undefined ? {} : { reason: made.error.context['reason'] }),
      })
      return
    }
    const stored = await storeSnapshot({
      files,
      snapshots,
      logger,
      channelId: input.channelId,
      bytes: made.value,
      at: clock.now(),
      grabbed: false,
    })
    if (stored) logger.debug('tv snapshot taken from a stream', { channelId: input.channelId })
  }

  return {
    /** A copy stream's poll listed `segment` of run `run` (its newest): maybe a snapshot. */
    segmentListed: ({
      channelId,
      run,
      segment,
      probe,
    }: {
      channelId: string
      run: number
      segment: string
      probe: TvChannelProbe | undefined
    }): void => {
      if (stopped || running.has(channelId) || running.size >= concurrency) return
      const nowMs = clock.now().getTime()
      if (!lastTried.has(channelId)) {
        const at = snapshots.snapshotAtOf(channelId)?.getTime()
        if (at !== undefined) lastTried.set(channelId, at)
      }
      if (!isFreeSnapshotDue({ lastAtMs: lastTried.get(channelId), nowMs })) return
      lastTried.set(channelId, nowMs)
      const controller = new AbortController()
      const interlaced = probe !== undefined && isInterlaced(probe.video)
      const done = take({ channelId, run, segment, interlaced }, controller.signal).finally(() => {
        running.delete(channelId)
      })
      running.set(channelId, { controller, done })
    },

    /** Stops the snapshots under way (shutdown) and waits for their ffmpeg. */
    stop: async (): Promise<void> => {
      stopped = true
      const under = [...running.values()]
      for (const { controller } of under) controller.abort()
      await Promise.all(under.map(({ done }) => done))
    },

    /** Settles once the snapshots under way are done: tests. */
    idle: async (): Promise<void> => {
      await Promise.all([...running.values()].map(({ done }) => done))
    },
  }
}

export type StreamSnapshots = ReturnType<typeof streamSnapshotsFactory>
