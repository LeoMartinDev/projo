import { expect, test } from 'bun:test'

import { exportFileName } from './stats.ts'

test('the export file name carries the UTC date and time', () => {
  expect(exportFileName(new Date('2026-10-24T09:05:07.123Z'))).toBe(
    'projo-export-20261024-090507.db',
  )
})
