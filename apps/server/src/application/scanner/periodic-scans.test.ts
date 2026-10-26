import { describe, expect, test } from 'bun:test'

import { createManualClock } from '../../../test/support/clock.ts'
import type { Library } from '../../core/library/library.ts'
import { NAMING_RULES_VERSION } from '../../core/naming/index.ts'
import type { NamingRulesVersionStore, ScanRequester, ScanRun } from '../../core/scanner/ports.ts'
import { periodicScansFactory } from './periodic-scans.ts'

const library = (id: string, scanIntervalMinutes: number) =>
  ({ id, scanIntervalMinutes }) as Library

const inMemoryRules = (version: number | undefined) => {
  let stored = version
  const store: NamingRulesVersionStore = {
    read: () => stored,
    write: (input) => {
      stored = input.version
    },
  }
  return { store, stored: () => stored }
}

const world = (rulesVersion: number | undefined) => {
  const clock = createManualClock()
  const requests: Parameters<ScanRequester>[0][] = []
  const runs = new Map<string, ScanRun>()
  const rules = inMemoryRules(rulesVersion)
  const tick = periodicScansFactory({
    libraryRepository: { list: () => [library('a', 15), library('b', 60)] },
    scanRunRepository: { latest: (id) => runs.get(id) },
    requestScan: (input) => {
      requests.push(input)
      runs.set(input.libraryId, { startedAt: clock.now() } as ScanRun)
      return { jobId: 'j', deduplicated: false }
    },
    namingRules: rules.store,
    clock,
  })
  return { clock, requests, rules, tick }
}

describe('startup and periodic scans (§7.4)', () => {
  test('the first tick scans everything, then each library at its own interval', () => {
    const { clock, requests, tick } = world(NAMING_RULES_VERSION)
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

  test.each([undefined, NAMING_RULES_VERSION - 1])(
    'names read with other rules (%p): the startup scan is full, once',
    (version) => {
      const { requests, rules, tick } = world(version)
      tick()
      expect(requests.map((r) => r.kind)).toEqual(['rules_update', 'rules_update'])
      expect(rules.stored()).toBe(NAMING_RULES_VERSION)
      const again = world(rules.stored())
      again.tick()
      expect(again.requests.map((r) => r.kind)).toEqual(['startup', 'startup'])
    },
  )
})
