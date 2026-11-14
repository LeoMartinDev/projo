import type { PlaybackSessionDto, TranscodeStatusDto } from '@projo/shared/api/playback'

import type { EngineStats, PlayerEngine } from '../core/engine.ts'
import type { PlaybackApi, Timers } from './ports.ts'

// What the playback info shows beyond the session itself (§10.7).
export type PlaybackInfoLive = {
  engine: EngineStats | undefined
  // The server's ffmpeg run; never asked for a `direct` session.
  transcode: TranscodeStatusDto | undefined
}

export const playbackInfoIntervalMs = 2000

/**
 * Reads the engine's stats and the server's ffmpeg run now, then every interval after the
 * previous read settled (never two at once). A failed read leaves that part undefined. Returns
 * what stops it; nothing is reported after.
 */
export const watchPlaybackInfo = ({
  session,
  engine,
  api,
  timers,
  onChange,
  intervalMs = playbackInfoIntervalMs,
}: {
  session: Pick<PlaybackSessionDto, 'id' | 'mode'>
  engine: Pick<PlayerEngine, 'stats'>
  api: Pick<PlaybackApi, 'transcodeStatus'>
  timers: Timers
  onChange: (live: PlaybackInfoLive) => void
  intervalMs?: number
}): (() => void) => {
  let stopped = false
  let timer: unknown
  const settled = <T>(read: () => Promise<T>): Promise<T | undefined> =>
    read().then(
      (value) => value,
      () => undefined,
    )
  const tick = () => {
    void Promise.all([
      settled(engine.stats),
      session.mode === 'direct'
        ? Promise.resolve(undefined)
        : settled(() => api.transcodeStatus(session.id)),
    ]).then(([stats, transcode]) => {
      if (stopped) return
      onChange({ engine: stats, transcode })
      timer = timers.setTimeout(tick, intervalMs)
    })
  }
  tick()
  return () => {
    stopped = true
    if (timer !== undefined) timers.clearTimeout(timer)
  }
}
