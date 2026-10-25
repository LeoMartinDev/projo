import { describe, expect, test } from 'bun:test'

import { analyzeMediaPath } from '../naming/index.ts'
import type { SourceSnapshot } from '../source/source.ts'
import {
  fileKey,
  type FoundFile,
  moveProbeCandidates,
  planScan,
  type PlanInput,
} from './scan-plan.ts'

const now = new Date('2026-03-01T12:00:00.000Z')
const earlier = new Date('2026-02-01T12:00:00.000Z')
const MB = 1_000_000

/** `undefined` in `overrides` removes the default. */
const snapshot = (
  overrides: { [K in keyof SourceSnapshot]?: SourceSnapshot[K] | undefined } & {
    id: string
    relativePath: string
  },
): SourceSnapshot =>
  Object.fromEntries(
    Object.entries({
      libraryId: 'lib',
      rootId: 'root',
      state: 'ready',
      sizeBytes: 5 * MB,
      mtimeMs: 100,
      inode: `1:${overrides.id}`,
      readyAt: earlier,
      classification: 'movie',
      parsed: {},
      matchState: 'unmatched',
      ...overrides,
    }).filter(([, value]) => value !== undefined),
  ) as SourceSnapshot

const file = (overrides: Partial<FoundFile> & { relativePath: string }): FoundFile => ({
  rootId: 'root',
  sizeBytes: 5 * MB,
  mtimeMs: 100,
  ...overrides,
})

const plan = (input: Partial<PlanInput> & Pick<PlanInput, 'known' | 'found'>) => {
  let counter = 0
  return planScan({
    libraryId: 'lib',
    now,
    full: false,
    signatures: new Map(),
    analyze: (relativePath) => analyzeMediaPath({ relativePath, hint: 'auto' }),
    newId: () => `new-${++counter}`,
    ...input,
  })
}

const patchOf = (result: ReturnType<typeof plan>, id: string) =>
  result.patches.find((change) => change.id === id)?.patch

describe('planScan: states (§7.3–7.5)', () => {
  test('new files enter quarantine, small ones are ignored', () => {
    const result = plan({
      known: [],
      found: [
        file({ relativePath: 'Inception (2010).mkv', inode: '1:9' }),
        file({ relativePath: 'tiny.mkv', sizeBytes: 10 }),
      ],
    })
    expect(result.inserts).toEqual([
      {
        id: 'new-1',
        libraryId: 'lib',
        rootId: 'root',
        relativePath: 'Inception (2010).mkv',
        extension: 'mkv',
        sizeBytes: 5 * MB,
        mtimeMs: 100,
        inode: '1:9',
        discoveredAt: now,
        classification: 'movie',
        parsed: { title: 'Inception', year: 2010 },
        matchState: 'unmatched',
      },
    ])
    expect(result.stats).toMatchObject({ seen: 2, discovered: 1, pending: 1 })
  })

  test('unknown classification goes to review', () => {
    const result = plan({ known: [], found: [file({ relativePath: 'Some Show - 12.mkv' })] })
    expect(result.inserts[0]).toMatchObject({
      classification: 'unknown',
      matchState: 'needs_review',
      reviewReason: 'classification_ambiguous',
    })
  })

  test('a ready source whose size or mtime moved goes back to quarantine', () => {
    const ready = snapshot({ id: 'a', relativePath: 'A.mkv' })
    const result = plan({
      known: [ready],
      found: [file({ relativePath: 'A.mkv', inode: '1:a', mtimeMs: 200 })],
    })
    expect(patchOf(result, 'a')).toEqual({
      sizeBytes: 5 * MB,
      mtimeMs: 200,
      inode: '1:a',
      state: 'pending',
      pendingReason: 'growing',
      pendingSince: now,
      unchangedSince: now,
      stableSince: undefined,
      missingSince: undefined,
    })
    const shrunk = plan({
      known: [ready],
      found: [file({ relativePath: 'A.mkv', inode: '1:a', sizeBytes: 10 })],
    })
    expect(patchOf(shrunk, 'a')).toMatchObject({ state: 'pending', pendingReason: 'too_small' })
  })

  test('a pending source keeps its pending_since when it changes again; failed ones are re-tested', () => {
    const pending = snapshot({
      id: 'p',
      relativePath: 'P.mkv',
      state: 'pending',
      pendingReason: 'growing',
      readyAt: undefined,
    })
    const grown = plan({
      known: [pending],
      found: [file({ relativePath: 'P.mkv', inode: '1:p', sizeBytes: 6 * MB })],
    })
    expect(patchOf(grown, 'p')).not.toHaveProperty('pendingSince')
    const failed = snapshot({
      id: 'f',
      relativePath: 'F.mkv',
      state: 'pending',
      pendingReason: 'decode_failed',
      readyAt: undefined,
    })
    expect(
      plan({ known: [failed], found: [file({ relativePath: 'F.mkv', inode: '1:f' })] }).retest,
    ).toEqual(['f'])
  })

  test('disappeared sources are missing; they come back ready only if unchanged and ready before', () => {
    const ready = snapshot({ id: 'a', relativePath: 'A.mkv' })
    expect(plan({ known: [ready], found: [] }).patches).toEqual([
      { id: 'a', patch: { state: 'missing', missingSince: now } },
    ])
    const missing = { ...ready, state: 'missing' as const }
    expect(
      patchOf(
        plan({ known: [missing], found: [file({ relativePath: 'A.mkv', inode: '1:a' })] }),
        'a',
      ),
    ).toEqual({
      state: 'ready',
      missingSince: undefined,
      inode: '1:a',
    })
    const missingChanged = plan({
      known: [missing],
      found: [file({ relativePath: 'A.mkv', inode: '1:a', mtimeMs: 5 })],
    })
    expect(patchOf(missingChanged, 'a')).toMatchObject({
      state: 'pending',
      pendingReason: 'growing',
    })
    // Was still in quarantine when it went missing: never straight to ready.
    const missingPending = { ...missing, pendingReason: 'growing' as const }
    expect(
      patchOf(
        plan({ known: [missingPending], found: [file({ relativePath: 'A.mkv', inode: '1:a' })] }),
        'a',
      ),
    ).toMatchObject({
      state: 'pending',
    })
  })

  test('rejected sources stay rejected, except on a full scan; full scans verify ready ones', () => {
    const rejected = snapshot({ id: 'r', relativePath: 'R.mkv', state: 'rejected' })
    const ready = snapshot({ id: 'a', relativePath: 'A.mkv' })
    const found = [
      file({ relativePath: 'R.mkv', inode: '1:r' }),
      file({ relativePath: 'A.mkv', inode: '1:a' }),
    ]
    expect(plan({ known: [rejected, ready], found }).patches).toEqual([])
    const full = plan({ known: [rejected, ready], found, full: true })
    expect(patchOf(full, 'r')).toMatchObject({ state: 'pending', pendingSince: now })
    expect(full.verify).toEqual(['a'])
    expect(plan({ known: [rejected], found: [] }).patches).toEqual([])
  })
})

describe('planScan: moves (§7.6)', () => {
  const ready = snapshot({
    id: 'a',
    relativePath: 'Old/Dune.mkv',
    inode: '1:77',
    signature: 'sig-a',
    stackGroupId: 'g',
  })

  test('same inode and size: the source moves, keeps its id and state, is re-parsed', () => {
    const result = plan({
      known: [ready],
      found: [file({ relativePath: 'Films/Dune (2021).mkv', inode: '1:77' })],
    })
    expect(result.inserts).toEqual([])
    expect(result.moved).toEqual(['a'])
    expect(patchOf(result, 'a')).toMatchObject({
      relativePath: 'Films/Dune (2021).mkv',
      parsed: { title: 'Dune', year: 2021 },
      classification: 'movie',
    })
    expect(patchOf(result, 'a')).not.toHaveProperty('state')
    expect(result.stats).toMatchObject({ moved: 1, missing: 0, discovered: 0 })
  })

  test('across roots of the same library', () => {
    const result = plan({
      known: [ready],
      found: [file({ rootId: 'root-2', relativePath: 'Dune.mkv', inode: '1:77' })],
    })
    expect(patchOf(result, 'a')).toMatchObject({ rootId: 'root-2', relativePath: 'Dune.mkv' })
  })

  test('same signature without inode match (copy then delete)', () => {
    const moved = file({ relativePath: 'Copy/Dune.mkv', inode: '2:5' })
    expect(moveProbeCandidates([ready], [moved])).toEqual([moved])
    const result = plan({
      known: [ready],
      found: [moved],
      signatures: new Map([[fileKey('root', 'Copy/Dune.mkv'), 'sig-a']]),
    })
    expect(result.moved).toEqual(['a'])
    expect(patchOf(result, 'a')).toMatchObject({ relativePath: 'Copy/Dune.mkv', inode: '2:5' })
  })

  test('different signature: a new source, the old one missing', () => {
    const result = plan({
      known: [ready],
      found: [file({ relativePath: 'Copy/Dune.mkv', inode: '2:5' })],
      signatures: new Map([[fileKey('root', 'Copy/Dune.mkv'), 'sig-other']]),
    })
    expect(result.inserts).toHaveLength(1)
    expect(patchOf(result, 'a')).toEqual({ state: 'missing', missingSince: now })
  })

  test('same inode but touched since: moved and back to quarantine', () => {
    const result = plan({
      known: [ready],
      found: [file({ relativePath: 'New.mkv', inode: '1:77', mtimeMs: 999 })],
    })
    expect(patchOf(result, 'a')).toMatchObject({
      relativePath: 'New.mkv',
      state: 'pending',
      pendingReason: 'growing',
    })
  })

  test('a missing source found elsewhere comes back', () => {
    const missing = { ...ready, state: 'missing' as const }
    const result = plan({
      known: [missing],
      found: [file({ relativePath: 'Back/Dune.mkv', inode: '1:77' })],
    })
    expect(patchOf(result, 'a')).toMatchObject({
      relativePath: 'Back/Dune.mkv',
      state: 'ready',
      missingSince: undefined,
    })
  })

  test('the matching of moves never reuses an origin twice', () => {
    const result = plan({
      known: [ready],
      found: [
        file({ relativePath: 'One.mkv', inode: '1:77' }),
        file({ relativePath: 'Two.mkv', inode: '1:77' }),
      ],
    })
    expect(result.moved).toEqual(['a'])
    expect(result.inserts.map((insert) => insert.relativePath)).toEqual(['Two.mkv'])
  })
})

describe('planScan: full scan re-parses (§7.4)', () => {
  test('a new hint re-classifies unchanged files; identical parses are left alone', () => {
    const source = snapshot({
      id: 'a',
      relativePath: 'Dune (2021).mkv',
      classification: 'movie',
      parsed: { year: 2021, title: 'Dune' },
    })
    const found = [file({ relativePath: 'Dune (2021).mkv', inode: '1:a' })]
    expect(plan({ known: [source], found, full: true }).patches).toEqual([])
    const asSeries = planScan({
      libraryId: 'lib',
      now,
      full: true,
      signatures: new Map(),
      known: [source],
      found,
      analyze: (relativePath) => analyzeMediaPath({ relativePath, hint: 'series' }),
      newId: () => 'x',
    })
    expect(asSeries.patches[0]?.patch).toMatchObject({
      classification: 'episode',
      matchState: 'needs_review',
    })
  })

  test('a parser fix re-classifies a misparsed file: `5.1x265` read as S1E265', () => {
    const relativePath =
      'Furiosa.une.Saga.Mad Max.2024.MULTi.VFF.4K.2160p.10bit.HDR10Plus.DV.WEBRip.DDP.Atmos.5.1x265-Elcrackito (Furiosa A Mad Max Saga).mkv'
    const source = snapshot({
      id: 'a',
      relativePath,
      classification: 'episode',
      parsed: { series: 'Furiosa une Saga Mad Max', year: 2024, season: 1, episode: 265 },
      matchState: 'needs_review',
    })
    const found = [file({ relativePath, inode: '1:a' })]
    expect(plan({ known: [source], found }).patches).toEqual([])
    expect(patchOf(plan({ known: [source], found, full: true }), 'a')).toEqual({
      classification: 'movie',
      parsed: { title: 'Furiosa une Saga Mad Max', year: 2024 },
      matchState: 'unmatched',
      reviewReason: undefined,
    })
  })
})
