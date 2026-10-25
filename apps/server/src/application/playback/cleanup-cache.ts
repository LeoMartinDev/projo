import type { Logger } from '../../core/logger.ts'
import type { TranscodeCacheInventory } from '../../core/playback/ports.ts'
import type { PlaybackSessionRepository } from '../../core/playback/session.ts'
import type { PlaybackSettingsReader } from '../../core/settings/settings.ts'

/** `settings.transcode_cache_max_gb` is in GiB. */
const bytesPerGb = 1024 ** 3

type Deps = {
  sessionRepository: Pick<PlaybackSessionRepository, 'findById'>
  transcodeCache: TranscodeCacheInventory
  playbackSettings: PlaybackSettingsReader
  logger: Logger
}

export type CleanupCacheReport = { removed: string[]; freedBytes: number; totalBytes: number }

/**
 * `cleanup_cache` (§10.3, §18, hourly): caps `/data/cache/transcode` at
 * `settings.transcode_cache_max_gb` by deleting the folders of ended sessions, oldest end first
 * (folders of sessions gone from the database before them), even within the 5 min grace the
 * periodic sweep gives them. The folder of a session not ended is never deleted, even if the
 * cache stays over the cap.
 */
export const cleanupCacheFactory =
  ({ sessionRepository, transcodeCache, playbackSettings, logger }: Deps) =>
  (): CleanupCacheReport => {
    const maxBytes = playbackSettings.read().transcodeCacheMaxGb * bytesPerGb
    const entries = transcodeCache.entries()
    let totalBytes = entries.reduce((sum, entry) => sum + entry.sizeBytes, 0)
    if (totalBytes <= maxBytes) return { removed: [], freedBytes: 0, totalBytes }

    const candidates = entries
      .flatMap((entry) => {
        const session = sessionRepository.findById(entry.sessionId)
        if (session !== undefined && session.endedAt === undefined) return []
        return [{ ...entry, endedAtMs: session?.endedAt?.getTime() ?? Number.NEGATIVE_INFINITY }]
      })
      .sort((a, b) => a.endedAtMs - b.endedAtMs)

    const removed: string[] = []
    let freedBytes = 0
    for (const candidate of candidates) {
      if (totalBytes <= maxBytes) break
      transcodeCache.remove(candidate.sessionId)
      removed.push(candidate.sessionId)
      freedBytes += candidate.sizeBytes
      totalBytes -= candidate.sizeBytes
    }
    if (totalBytes > maxBytes) {
      logger.warn('transcode cache over its cap with active sessions only', {
        totalBytes,
        maxBytes,
      })
    }
    if (removed.length > 0) {
      logger.info('transcode cache cleaned', { removed: removed.length, freedBytes, totalBytes })
    }
    return { removed, freedBytes, totalBytes }
  }

export type CleanupCache = ReturnType<typeof cleanupCacheFactory>
