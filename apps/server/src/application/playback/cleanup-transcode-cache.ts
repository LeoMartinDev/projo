import type { Logger } from '../../core/logger.ts'
import type { TranscodeCacheInventory } from '../../core/playback/ports.ts'
import type { PlaybackSessionRepository } from '../../core/playback/session.ts'
import type { PlaybackSettingsReader } from '../../core/settings/settings.ts'

const bytesPerGb = 1024 ** 3

type Deps = {
  sessionRepository: Pick<PlaybackSessionRepository, 'findById'>
  transcodeCache: TranscodeCacheInventory
  playbackSettings: PlaybackSettingsReader
  logger: Logger
}

export type CleanupTranscodeCacheReport = {
  removed: string[]
  freedBytes: number
  totalBytes: number
}

export const cleanupTranscodeCacheFactory =
  ({ sessionRepository, transcodeCache, playbackSettings, logger }: Deps) =>
  (): CleanupTranscodeCacheReport => {
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

export type CleanupTranscodeCache = ReturnType<typeof cleanupTranscodeCacheFactory>
