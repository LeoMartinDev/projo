import { expect, test } from 'bun:test'

import { createTestDatabase } from '../../../test/support/database.ts'
import { updateRuns } from './schema/ops.ts'
import { createSqliteUpdateRepository } from './update-repository.ts'

test('reads a run whose error code was written by a newer version', () => {
  const db = createTestDatabase()
  db.insert(updateRuns)
    .values({
      id: 'r1',
      kind: 'update',
      fromVersion: '1.2.0',
      toVersion: '1.1.0',
      requestedAt: '2026-10-23T10:00:00.000Z',
      outcome: 'failed',
      error: { code: 'update/from_the_future', message: 'boom' },
    })
    .run()
  expect(createSqliteUpdateRepository({ db }).recentRuns(10)).toMatchObject([
    { id: 'r1', error: { code: 'update/from_the_future', message: 'boom' } },
  ])
})
