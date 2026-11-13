import { describe, expect, test } from 'bun:test'

import { createManualClock } from '../../../test/support/clock.ts'
import { silentLogger } from '../../../test/support/logger.ts'
import { t0 } from '../../../test/support/operations-world.ts'
import { exportDatabaseFactory } from './export-database.ts'

describe('database export (§5.4)', () => {
  test('writes projo-export-<time>.db in the backups folder', () => {
    const written: string[] = []
    const exportDatabase = exportDatabaseFactory({
      exporter: {
        exportTo: (file) => {
          written.push(file)
          return { ok: true, value: { sizeBytes: 42 } }
        },
      },
      backupsDir: '/data/db/backups',
      clock: createManualClock(t0),
      logger: silentLogger,
    })
    expect(exportDatabase()).toEqual({
      ok: true,
      value: {
        file: 'projo-export-20261024-120000-000.db',
        path: '/data/db/backups/projo-export-20261024-120000-000.db',
        sizeBytes: 42,
        createdAt: t0,
      },
    })
    expect(written).toEqual(['/data/db/backups/projo-export-20261024-120000-000.db'])
  })
})
