import { type AppError, map, type Result } from '@projo/shared'

import type { Clock } from '../../core/clock.ts'
import type { Logger } from '../../core/logger.ts'
import { type DatabaseExporter, exportFileName } from '../../core/stats/stats.ts'

type Deps = {
  exporter: DatabaseExporter
  backupsDir: string
  clock: Clock
  logger: Logger
}

export type ExportDatabaseError = AppError<'db/export_failed'>

export const exportDatabaseFactory =
  ({ exporter, backupsDir, clock, logger }: Deps) =>
  (): Result<
    { file: string; path: string; sizeBytes: number; createdAt: Date },
    ExportDatabaseError
  > => {
    const createdAt = clock.now()
    const file = exportFileName(createdAt)
    const path = `${backupsDir.replace(/\/+$/u, '')}/${file}`
    const result = map(exporter.exportTo(path), ({ sizeBytes }) => ({
      file,
      path,
      sizeBytes,
      createdAt,
    }))
    if (result.ok) logger.info('database exported', { file, sizeBytes: result.value.sizeBytes })
    else logger.error('database export failed', { code: result.error.code, error: result.error })
    return result
  }

export type ExportDatabase = ReturnType<typeof exportDatabaseFactory>
