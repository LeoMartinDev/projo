import { availableParallelism } from 'node:os'

import { z } from 'zod'

import { ok } from '@projo/shared'

import { fingerprintSeasonFactory } from '../../application/segments/fingerprint-season.ts'
import type { AudioFingerprinter } from '../../core/segments/fingerprint.ts'
import { createFpcalcFingerprinter } from '../../infrastructure/segments/fpcalc.ts'
import { createSqliteFingerprintCatalog } from '../../infrastructure/sqlite/fingerprint-catalog.ts'
import { createSqliteFingerprintSettings } from '../../infrastructure/sqlite/fingerprint-settings.ts'
import { createSqlitePlaybackSessionRepository } from '../../infrastructure/sqlite/playback-session-repository.ts'
import { createSqliteSegmentRepository } from '../../infrastructure/sqlite/segment-repository.ts'
import { defineJobHandler } from '../jobs/handler.ts'
import type { Platform } from './platform.ts'

const seasonPayload = z.object({ seasonId: z.string().min(1) })

export type FingerprintModuleOptions = {
  /** Default: the machine's (§18 heavy jobs wait for transcodes below 4 cores). */
  cores?: number
  /** Default: ffmpeg + fpcalc, temporary WAVs under `/data/cache/fingerprint`. */
  fingerprinter?: AudioFingerprinter
}

/**
 * §12.3 local fingerprinting: the `fingerprint_season` handler (ffmpeg audio extraction, `fpcalc`,
 * comparison of the episodes of a season), enqueued by `fetch_segments` for the episodes the
 * chain left without `intro` or `credits`.
 */
export const buildFingerprintModule = (
  { db, ids, clock, logger, paths, jobQueue }: Platform,
  {
    cores = availableParallelism(),
    fingerprinter = createFpcalcFingerprinter({ tempDir: `${paths.cache.dir}/fingerprint` }),
  }: FingerprintModuleOptions = {},
) => {
  const moduleLogger = logger.child({ module: 'fingerprint' })
  const sessionRepository = createSqlitePlaybackSessionRepository({ db })
  // §18: heavy ffmpeg jobs wait while a transcode runs on a server with fewer than 4 cores.
  const heavyJobsAllowed = () =>
    cores >= 4 ||
    !sessionRepository.listActive().some((session) => session.mode === 'hls_transcode')

  const fingerprintSeason = fingerprintSeasonFactory({
    catalog: createSqliteFingerprintCatalog({ db }),
    segmentRepository: createSqliteSegmentRepository({ db, ids, clock }),
    fingerprinter,
    settings: createSqliteFingerprintSettings({ db }),
    jobQueue,
    clock,
    logger: moduleLogger,
  })

  return {
    jobHandlers: {
      fingerprint_season: defineJobHandler({
        payload: seasonPayload,
        // §18: one at a time (heavy ffmpeg), priority 10 (`jobDefaults`).
        concurrency: 1,
        isRunnable: heavyJobsAllowed,
        run: async ({ seasonId }, { signal, reportProgress }) => {
          const result = await fingerprintSeason({ seasonId, signal, reportProgress })
          return result.ok ? ok() : result
        },
      }),
    },
  }
}

export type FingerprintModule = ReturnType<typeof buildFingerprintModule>
