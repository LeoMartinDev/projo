import { Hono } from 'hono'

import type { AdminStatsDto, DbExportResponse, StorageDto } from '@projo/shared/api/system'

import type {
  AdminStats,
  ExportDatabase,
  GetAdminStats,
  GetStorage,
} from '../../../application/operations/types.ts'
import type { AppEnv } from '../context.ts'
import { respondError } from '../errors.ts'

const toDto = (stats: AdminStats): AdminStatsDto => ({
  counts: stats.counts,
  runningScans: stats.runningScans.map((scan) => ({
    libraryId: scan.libraryId,
    libraryName: scan.libraryName,
    scanRunId: scan.scanRunId,
    kind: scan.kind,
    startedAt: scan.startedAt.toISOString(),
  })),
  activePlaybackSessions: stats.activePlaybackSessions,
  unreadNotifications: stats.unreadNotifications,
  failedJobs: stats.failedJobs,
  version: stats.version,
  ...(stats.updateAvailable === undefined ? {} : { updateAvailable: stats.updateAvailable }),
})

const toStorageDto = (storage: Awaited<ReturnType<GetStorage>>): StorageDto => ({
  dataDir: storage.dataDir,
  categories: storage.categories,
  ...(storage.totalBytes === undefined ? {} : { totalBytes: storage.totalBytes }),
  ...(storage.freeBytes === undefined ? {} : { freeBytes: storage.freeBytes }),
  measuredAt: storage.measuredAt.toISOString(),
})

/**
 * §15 "Dashboard" and "Server", §17.2: `GET /admin/stats`, `GET /admin/storage`,
 * `POST /admin/db/export`. Mounted at `/api/v1/admin`.
 */
export const adminSystemRoutes = ({
  getStats,
  getStorage,
  exportDatabase,
}: {
  getStats: GetAdminStats
  getStorage: GetStorage
  exportDatabase: ExportDatabase
}) =>
  new Hono<AppEnv>()
    .get('/stats', (c) => c.json(toDto(getStats()), 200))
    .get('/storage', async (c) => c.json(toStorageDto(await getStorage()), 200))
    .post('/db/export', (c) => {
      const result = exportDatabase()
      if (!result.ok) return respondError(c, result.error)
      const { file, path, sizeBytes, createdAt } = result.value
      const body: DbExportResponse = { file, path, sizeBytes, createdAt: createdAt.toISOString() }
      return c.json(body, 201)
    })

export type AdminSystemRoutes = ReturnType<typeof adminSystemRoutes>
