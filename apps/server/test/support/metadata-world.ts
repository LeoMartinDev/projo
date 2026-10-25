import { Hono } from 'hono'

import { dataPathsFor } from '../../src/core/data-paths.ts'
import type { JobType } from '../../src/core/jobs/job.ts'
import type { ImageReencoder } from '../../src/core/metadata/editing.ts'
import type { AppEnv } from '../../src/entrypoints/http/context.ts'
import { type JobHandler, mergeJobHandlers } from '../../src/entrypoints/jobs/handler.ts'
import { buildMetadataModule } from '../../src/entrypoints/modules/metadata.ts'
import { createTempDir } from './database.ts'
import { silentLogger } from './logger.ts'
import { createScannerWorld } from './scanner-world.ts'
import { startTmdbServer, TEST_TMDB_KEY } from './tmdb-server.ts'

/**
 * The scanner world (real scan, ffprobe, ffmpeg, in-memory database, manual clock) plus the
 * metadata module against a local TMDB replay server, images written to a temporary data dir.
 * Jobs run only when `runJobs` says so. `request` reaches the admin API of both, `requestApi`
 * the user API (`/images/:id`).
 */
export const createMetadataWorld = ({
  canViewImage,
  imageReencoder,
}: {
  canViewImage?: (input: { imageId: string; profileId: string }) => boolean
  /** Uploaded images (§9.3); default: real ffmpeg. */
  imageReencoder?: ImageReencoder
} = {}) => {
  const scanner = createScannerWorld()
  const data = createTempDir('projo-metadata-')
  const tmdb = startTmdbServer()
  const endedItems: string[][] = []
  const platform = { ...scanner.platform, paths: dataPathsFor(data.path) }
  const metadata = buildMetadataModule(platform, {
    playbackSessions: {
      endWithin: (scope) => {
        if ('itemIds' in scope) endedItems.push([...scope.itemIds])
      },
    },
    ...(canViewImage === undefined ? {} : { canViewImage }),
    ...(imageReencoder === undefined ? {} : { imageReencoder }),
    tmdb: { apiBaseUrl: tmdb.apiBaseUrl, imageBaseUrl: tmdb.imageBaseUrl, sleep: async () => {} },
  })
  scanner.metadataContextLater.current = metadata.libraryMetadataContext
  const handlers = mergeJobHandlers(scanner.scanner.jobHandlers, metadata.jobHandlers)

  const app = new Hono<AppEnv>()
    .use('*', async (c, next) => {
      c.set('logger', silentLogger)
      c.set('account', { id: 'admin-1', username: 'leo', role: 'admin' })
      c.set('profileId', 'profile-1')
      await next()
    })
    .route('/api/v1', metadata.routes.images)
    .route('/api/v1/admin', metadata.routes.adminSourceReview)
    .route('/api/v1/admin', metadata.routes.adminItems)
    .route('/api/v1/admin', metadata.routes.adminSettings)

  /** Admin API: libraries, sources (scanner world), then the metadata routes. */
  const ours =
    /^\/(settings|tmdb\/|items\/|sources\/[^/]+\/(assign|reject)|libraries\/[^/]+\/refresh-metadata)/u
  const request = async (path: string, init: RequestInit & { json?: unknown } = {}) => {
    if (!ours.test(path)) return scanner.request(path, init)
    const { json, ...rest } = init
    return app.request(`/api/v1/admin${path}`, {
      ...rest,
      ...(json === undefined
        ? {}
        : { body: JSON.stringify(json), headers: { 'content-type': 'application/json' } }),
    })
  }
  const requestApi = (path: string) => app.request(`/api/v1${path}`)

  /** Runs due jobs of these types (highest priority, oldest first) until none is left. */
  const runJobs = async (types: readonly JobType[], max = 500): Promise<number> => {
    let ran = 0
    while (ran < max) {
      const job = scanner.jobRepository.claimNext({ types, now: scanner.clock.now() })
      if (job === undefined) return ran
      const handler: JobHandler | undefined = handlers[job.type]
      if (handler === undefined) throw new Error(`no handler for ${job.type}`)
      const result = await handler.run(job.payload, {
        job,
        signal: new AbortController().signal,
        reportProgress: () => {},
        logger: silentLogger,
      })
      if (result.ok) scanner.jobRepository.complete({ id: job.id, finishedAt: scanner.clock.now() })
      else
        scanner.jobRepository.fail({
          id: job.id,
          error: { code: result.error.code, message: result.error.message },
          finishedAt: scanner.clock.now(),
        })
      ran += 1
    }
    return ran
  }

  const setKey = (key = TEST_TMDB_KEY) =>
    request('/settings', { method: 'PATCH', json: { metadata: { tmdbApiKey: key } } })

  return {
    ...scanner,
    data,
    tmdb,
    metadata,
    endedItems,
    request,
    requestApi,
    runJobs,
    setKey,
    stop: async () => {
      await scanner.stop()
      tmdb.stop()
      data.cleanup()
    },
  }
}

export type MetadataWorld = ReturnType<typeof createMetadataWorld>
