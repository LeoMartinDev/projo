import { appError, err, ok, type Result } from '@projo/shared'

import type { Clock } from '../../core/clock.ts'
import type { Logger } from '../../core/logger.ts'
import type { PlaybackSessionRepository } from '../../core/playback/session.ts'
import type {
  TranscodeLimitReached,
  TranscodeSlotHolder,
  TranscodeSlots,
} from '../../core/playback/transcode-slots.ts'
import type { PlaybackSettingsReader } from '../../core/settings/settings.ts'
import { runningTranscodes } from './shared/running-transcodes.ts'

/**
 * The transcode slots held by live `compat` streams (§29.4, §10.3), in memory: a slot is free
 * while the playback sessions in `hls_transcode` and the slots held stay under
 * `max_concurrent_transcodes`; otherwise idle holders are evicted, the one idle the longest
 * first and only as many as needed. Built once, in the playback module.
 */
export const transcodeSlotsFactory = ({
  sessionRepository,
  playbackSettings,
  clock,
  logger,
}: {
  sessionRepository: Pick<PlaybackSessionRepository, 'listActive'>
  playbackSettings: PlaybackSettingsReader
  clock: Clock
  logger: Logger
}): TranscodeSlots & { held: () => number } => {
  const holders = new Map<string, TranscodeSlotHolder>()

  /** Makes room for one more transcode beside `playing` playback transcodes and the holders. */
  const roomFor = (playing: number): Result<void, TranscodeLimitReached> => {
    const limit = playbackSettings.read().maxConcurrentTranscodes
    const needed = playing + holders.size + 1 - limit
    if (needed <= 0) return ok()
    const idle = [...holders]
      .map(([id, holder]) => ({ id, holder, order: holder.idleOrder() }))
      .filter((entry): entry is typeof entry & { order: number } => entry.order !== undefined)
      .sort((a, b) => a.order - b.order)
    if (idle.length < needed) {
      return err(
        appError('playback/transcode_limit_reached', 'too many transcodes running', {
          context: { limit },
        }),
      )
    }
    for (const { id, holder } of idle.slice(0, needed)) {
      logger.info('idle transcode evicted for a new one', { holder: id })
      holder.evict()
      // An eviction always gives the slot back, even from a holder that forgot to.
      holders.delete(id)
    }
    return ok()
  }

  const playing = (): number =>
    runningTranscodes(sessionRepository.listActive(), clock.now()).length

  return {
    acquire: (id, holder) => {
      if (holders.has(id)) return ok()
      const room = roomFor(playing())
      if (!room.ok) return room
      holders.set(id, holder)
      return ok()
    },
    release: (id) => {
      holders.delete(id)
    },
    admitPlayback: (count) => roomFor(count),
    held: () => holders.size,
  }
}
