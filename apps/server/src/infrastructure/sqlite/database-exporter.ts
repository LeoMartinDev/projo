import { statSync } from 'node:fs'

import { appError, err, ok } from '@projo/shared'

import type { DatabaseExporter } from '../../core/stats/stats.ts'
import type { Db } from './database.ts'

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
