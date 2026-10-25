import { describe, expect, test } from 'bun:test'

import { createManualClock } from '../../../test/support/clock.ts'
import type { Library } from '../../core/library/library.ts'
import type { ScanRequester, ScanRun } from '../../core/scanner/ports.ts'
import { periodicScansFactory } from './periodic-scans.ts'

const library = (id: string, scanIntervalMinutes: number) =>
  ({ id, scanIntervalMinutes }) as Library

describe('startup and periodic scans (§7.4)', () => {
  test('the first tick scans everything, then each library at its own interval', () => {
    const clock = createManualClock()
    const requests: Parameters<ScanRequester>[0][] = []
    const runs = new Map<string, ScanRun>()
    const tick = periodicScansFactory({
      libraryRepository: { list: () => [library('a', 15), library('b', 60)] },
      scanRunRepository: { latest: (id) => runs.get(id) },
      requestScan: (input) => {
        requests.push(input)
        runs.set(input.libraryId, { startedAt: clock.now() } as ScanRun)
        return { jobId: 'j', deduplicated: false }
      },
      clock,
    })
    expect(tick()).toEqual(['a', 'b'])
    expect(requests.map((r) => r.kind)).toEqual(['startup', 'startup'])
    clock.advance(14 * 60_000)
    expect(tick()).toEqual([])
    clock.advance(60_000)
    expect(tick()).toEqual(['a'])
    clock.advance(45 * 60_000)
    expect(tick()).toEqual(['a', 'b'])
    expect(requests.at(-1)).toEqual({ libraryId: 'b', kind: 'periodic' })
  })
})
