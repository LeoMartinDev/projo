import { statSync } from 'node:fs'

import { appError, err, ok } from '@projo/shared'

import type { DatabaseExporter } from '../../core/stats/stats.ts'
import type { Db } from './database.ts'

/**
 * "Exporter la base" (§5.4, §21): `VACUUM INTO` a new file, a consistent copy taken while the
 * server runs (WAL). SQLite refuses an existing file: the name carries the time.
 */
export const createSqliteDatabaseExporter = ({ db }: { db: Db }): DatabaseExporter => ({
  exportTo: (file) => {
    try {
      db.$client.run('VACUUM INTO ?', [file])
      return ok({ sizeBytes: statSync(file).size })
    } catch (cause) {
      return err(
        appError('db/export_failed', 'database export failed', { context: { file }, cause }),
      )
    }
  },
})
