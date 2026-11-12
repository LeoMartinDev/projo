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
import { defineJobHandlers } from '../jobs/handler.ts'
import type { Platform } from './platform.ts'
import { defineModule } from './types.ts'

const seasonPayload = z.object({ seasonId: z.string().min(1) })

export type FingerprintModuleOptions = {
  cores?: number
  fingerprinter?: AudioFingerprinter
}

export const buildFingerprintModule = (
  { db, ids, clock, logger, paths, jobQueue }: Platform,
  {
    cores = availableParallelism(),
    fingerprinter = createFpcalcFingerprinter({
      tempDir: `${paths.cache.dir}/fingerprint`,
      processPriority: 'background',
    }),
  }: FingerprintModuleOptions = {},
) => {
  const moduleLogger = logger.child({ module: 'fingerprint' })
  const sessionRepository = createSqlitePlaybackSessionRepository({ db })
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

  return defineModule({
    jobHandlers: defineJobHandlers({
      fingerprint_season: {
        payload: seasonPayload,
        concurrency: 1,
        group: 'heavy_ffmpeg',
        isRunnable: heavyJobsAllowed,
        run: async ({ seasonId }, { signal, reportProgress }) => {
          const result = await fingerprintSeason({ seasonId, signal, reportProgress })
          return result.ok ? ok() : result
        },
      },
    }),
  })
}

export type FingerprintModule = ReturnType<typeof buildFingerprintModule>
