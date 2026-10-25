import { describe, expect, test } from 'bun:test'

import { decideStability, type StabilityInput } from './stability.ts'

const t0 = new Date('2026-01-01T00:00:00.000Z')
const at = (ms: number) => new Date(t0.getTime() + ms)
const quietPeriodMs = 120_000
const file = { sizeBytes: 5_000_000, mtimeMs: 1_000.5 }

type Recorded = StabilityInput['recorded']
const input = (
  overrides: Partial<Omit<StabilityInput, 'recorded'>> & {
    recorded?: { [K in keyof Recorded]?: Recorded[K] | undefined }
  },
): StabilityInput => ({
  recorded: Object.fromEntries(
    Object.entries({
      ...file,
      pendingReason: 'growing',
      unchangedSince: t0,
      ...overrides.recorded,
    }).filter(([, value]) => value !== undefined),
  ) as Recorded,
  observed: 'observed' in overrides ? overrides.observed : file,
  now: overrides.now ?? at(0),
  quietPeriodMs: overrides.quietPeriodMs ?? quietPeriodMs,
})

describe('decideStability (§7.3 step 3)', () => {
  test('waits for the whole quiet period, then declares the file stable', () => {
    expect(decideStability(input({ now: at(30_000) }))).toEqual({
      kind: 'waiting',
      remainingMs: 90_000,
      startCounter: false,
    })
    expect(decideStability(input({ now: at(119_999) }))).toMatchObject({
      kind: 'waiting',
      remainingMs: 1,
    })
    expect(decideStability(input({ now: at(120_000) }))).toEqual({
      kind: 'stable',
      stableSince: at(120_000),
    })
  })

  test('a growing size restarts the counter', () => {
    expect(
      decideStability(
        input({ now: at(200_000), observed: { ...file, sizeBytes: file.sizeBytes + 1 } }),
      ),
    ).toEqual({
      kind: 'changed',
      sizeBytes: file.sizeBytes + 1,
      mtimeMs: file.mtimeMs,
      reason: 'growing',
    })
  })

  test('pre-allocated file: same size, only the mtime moves, still a change', () => {
    expect(
      decideStability(
        input({ now: at(200_000), observed: { ...file, mtimeMs: file.mtimeMs + 0.001 } }),
      ),
    ).toMatchObject({ kind: 'changed', reason: 'growing' })
  })

  test('a file below 1 MB never gets probed', () => {
    expect(decideStability(input({ observed: { sizeBytes: 10, mtimeMs: 2 } }))).toMatchObject({
      kind: 'changed',
      reason: 'too_small',
    })
    expect(
      decideStability(
        input({ now: at(10_000_000), recorded: { ...file, pendingReason: 'too_small' } }),
      ),
    ).toMatchObject({ kind: 'waiting' })
  })

  test('starts the counter when it was never set; a zero quiet period is immediate', () => {
    expect(
      decideStability(
        input({ recorded: { ...file, pendingReason: 'growing', unchangedSince: undefined } }),
      ),
    ).toEqual({ kind: 'waiting', remainingMs: quietPeriodMs, startCounter: true })
    expect(
      decideStability(
        input({
          quietPeriodMs: 0,
          recorded: { ...file, pendingReason: 'growing', unchangedSince: undefined },
        }),
      ),
    ).toEqual({ kind: 'stable', stableSince: at(0) })
  })

  test('failed probes wait for a change; gone files are left to the scan', () => {
    expect(
      decideStability(
        input({ now: at(10_000_000), recorded: { ...file, pendingReason: 'decode_failed' } }),
      ),
    ).toEqual({
      kind: 'failed',
    })
    expect(
      decideStability(
        input({
          recorded: { ...file, pendingReason: 'probe_failed' },
          observed: { ...file, sizeBytes: 6_000_000 },
        }),
      ),
    ).toMatchObject({ kind: 'changed' })
    expect(decideStability(input({ observed: undefined }))).toEqual({ kind: 'gone' })
  })

  test('an already stable source stays stable', () => {
    expect(
      decideStability(
        input({
          now: at(500_000),
          recorded: { ...file, pendingReason: 'growing', stableSince: at(120_000) },
        }),
      ),
    ).toEqual({ kind: 'stable', stableSince: at(120_000) })
  })
})
