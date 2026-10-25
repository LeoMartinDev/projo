import { describe, expect, test } from 'bun:test'
import i18next, { type TFunction } from 'i18next'

import type { LibraryDto } from '@projo/shared/api/libraries'

import { resources } from '../../shared/i18n/index.ts'
import { addReadySource, createThrottle, scanPercent } from './live-scans.ts'
import {
  hasAnalysisInProgress,
  isScanning,
  libraryState,
  rootErrorLabel,
} from './library-status.tsx'
import { notificationDetail } from './operations/notification-text.ts'

const stats = { discovered: 0, pending: 0, ready: 0, missing: 0, errors: 0, seen: 0, moved: 0 }

const library = (patch: Partial<LibraryDto> = {}): LibraryDto => ({
  id: 'lib',
  name: 'Films',
  hint: 'auto',
  scanIntervalMinutes: 15,
  watchEnabled: true,
  quietPeriodSeconds: 120,
  detectSegments: true,
  preExtractSubtitles: false,
  trickplayEnabled: true,
  ratingCountry: 'FR',
  createdAt: '2026-10-23T10:00:00Z',
  roots: [{ id: 'r', path: '/media', state: 'ok', lastFileCount: 3 }],
  sourceCounts: { pending: 0, ready: 3, missing: 0, rejected: 0 },
  analysis: { waiting: 0, verifying: 0, failed: 0 },
  ...patch,
})

const finishedScan = (finishedAt: string, error?: string) => ({
  id: 'run',
  libraryId: 'lib',
  kind: 'manual_quick' as const,
  startedAt: '2026-10-23T11:00:00Z',
  finishedAt,
  stats,
  ...(error === undefined ? {} : { error }),
})

const lastScan = finishedScan('2026-10-23T12:00:00Z')
const { finishedAt: _, ...runningScan } = lastScan

/** 78 files found by the first scan of a NAS share (the case that read "up to date" too early). */
const nas = (
  ready: number,
  analysis: LibraryDto['analysis'],
  patch: Partial<LibraryDto> = {},
): LibraryDto =>
  library({
    sourceCounts: { pending: 78 - ready, ready, missing: 0, rejected: 0 },
    analysis,
    lastScan,
    ...patch,
  })

describe('libraryState', () => {
  test('discovery: a requested, live or unfinished scan', () => {
    const queued = libraryState(nas(0, { waiting: 0, verifying: 0, failed: 0 }), {
      status: 'queued',
      since: '2026-10-23T12:30:00Z',
    })
    expect(queued).toMatchObject({ kind: 'analyzing', phase: { step: 'queued' } })
    expect(isScanning(queued)).toBe(true)

    const live = { status: 'running' as const, stats, phase: 'discovering' as const }
    expect(libraryState(library(), live)).toEqual({
      kind: 'analyzing',
      phase: { step: 'discovering', live },
      ready: 3,
      total: 3,
      failed: 0,
    })

    const unfinished = libraryState(library({ lastScan: runningScan }), undefined)
    expect(unfinished).toMatchObject({ kind: 'analyzing', phase: { step: 'discovering' } })
    expect(isScanning(unfinished)).toBe(true)
  })

  test('quarantine: the scan is over but files wait for their quiet period', () => {
    const state = libraryState(
      nas(0, { waiting: 78, verifying: 0, failed: 0, nextReadyAt: '2026-10-23T12:02:00Z' }),
      undefined,
    )
    expect(state).toEqual({
      kind: 'analyzing',
      phase: { step: 'waiting', nextReadyAt: '2026-10-23T12:02:00Z' },
      ready: 0,
      total: 78,
      failed: 0,
    })
    expect(isScanning(state)).toBe(false)
    expect(hasAnalysisInProgress(nas(0, { waiting: 78, verifying: 0, failed: 0 }))).toBe(true)
  })

  test('verification wins over files still waiting; failures are counted apart', () => {
    expect(
      libraryState(
        nas(12, { waiting: 30, verifying: 34, failed: 2, nextReadyAt: '2026-10-23T12:02:00Z' }),
        undefined,
      ),
    ).toEqual({
      kind: 'analyzing',
      phase: { step: 'verifying' },
      ready: 12,
      total: 76,
      failed: 2,
    })
  })

  test('failures alone do not keep the analysis going', () => {
    const library = nas(75, { waiting: 0, verifying: 0, failed: 3 })
    expect(libraryState(library, undefined)).toEqual({ kind: 'ok', failed: 3 })
    expect(hasAnalysisInProgress(library)).toBe(false)
  })

  test('finished: à jour only when nothing is in progress', () => {
    expect(libraryState(nas(78, { waiting: 0, verifying: 0, failed: 0 }), undefined)).toEqual({
      kind: 'ok',
      failed: 0,
    })
  })

  test('a requested scan already finished is not shown as queued', () => {
    const state = libraryState(library({ lastScan: finishedScan('2026-10-23T12:00:01Z') }), {
      status: 'queued',
      since: '2026-10-23T12:00:00Z',
    })
    expect(state).toEqual({ kind: 'ok', failed: 0 })
  })

  test('unreachable roots, then failed scans, then never', () => {
    expect(
      libraryState(
        library({ roots: [{ id: 'r', path: '/nas', state: 'unreachable', lastFileCount: 0 }] }),
        undefined,
      ),
    ).toEqual({ kind: 'unreachable', path: '/nas' })
    expect(
      libraryState(
        library({ lastScan: finishedScan('2026-10-23T12:00:00Z', 'scan/interrupted') }),
        undefined,
      ),
    ).toEqual({ kind: 'failed', code: 'scan/interrupted' })
    expect(libraryState(library(), undefined)).toEqual({ kind: 'never' })
  })

  test('files on their way are shown before a past scan error', () => {
    expect(
      libraryState(
        library({
          lastScan: finishedScan('2026-10-23T12:00:00Z', 'scan/interrupted'),
          analysis: { waiting: 2, verifying: 0, failed: 0 },
        }),
        undefined,
      ),
    ).toMatchObject({ kind: 'analyzing', phase: { step: 'waiting' } })
  })
})

describe('createThrottle', () => {
  const manualTimers = () => {
    const due: (() => void)[] = []
    return {
      timers: {
        set: (run: () => void) => {
          due.push(run)
          return due.length as unknown as ReturnType<typeof setTimeout>
        },
        clear: () => {
          due.length = 0
        },
      },
      elapse: () => due.shift()?.(),
    }
  }

  test('runs at once, then folds a burst into one run at the end of the window', () => {
    const { timers, elapse } = manualTimers()
    let runs = 0
    const throttle = createThrottle(() => (runs += 1), 2000, timers)
    throttle.trigger()
    expect(runs).toBe(1)
    for (let i = 0; i < 5000; i += 1) throttle.trigger()
    expect(runs).toBe(1)
    elapse()
    expect(runs).toBe(2)
    // Quiet window: nothing more, and the next trigger runs at once again.
    elapse()
    expect(runs).toBe(2)
    throttle.trigger()
    expect(runs).toBe(3)
  })

  test('cancel drops the pending run', () => {
    const { timers, elapse } = manualTimers()
    let runs = 0
    const throttle = createThrottle(() => (runs += 1), 2000, timers)
    throttle.trigger()
    throttle.trigger()
    throttle.cancel()
    elapse()
    expect(runs).toBe(1)
  })
})

describe('addReadySource', () => {
  test('merges ready files of the same library within a minute', () => {
    const one = addReadySource([], 'lib', '2026-10-23T12:00:00Z')
    const two = addReadySource(one, 'lib', '2026-10-23T12:00:20Z')
    expect(two).toHaveLength(1)
    expect(two[0]).toMatchObject({ kind: 'sources_ready', count: 2 })
    expect(addReadySource(two, 'other', '2026-10-23T12:00:30Z')).toHaveLength(2)
    expect(addReadySource(two, 'lib', '2026-10-23T12:05:00Z')).toHaveLength(2)
  })
})

describe('scanPercent', () => {
  const running = (seen: number, phase: 'discovering' | 'processing', total?: number) => ({
    status: 'running' as const,
    stats: { ...stats, seen },
    phase,
    ...(total === undefined ? {} : { total }),
  })

  test('indeterminate while the total is unknown (first walk) or queued', () => {
    expect(scanPercent(running(40, 'discovering'))).toBeUndefined()
    expect(scanPercent({ status: 'queued', since: 'x' })).toBeUndefined()
    expect(scanPercent(undefined)).toBeUndefined()
  })

  test('seen over the expected total, capped at 99 until the walk is over', () => {
    expect(scanPercent(running(25, 'discovering', 200))).toBe(12)
    expect(scanPercent(running(250, 'discovering', 200))).toBe(99)
    expect(scanPercent(running(0, 'discovering', 0))).toBeUndefined()
    expect(scanPercent(running(250, 'processing', 250))).toBe(100)
  })
})

describe('unreachable root reason (§7.5)', () => {
  const translator = async (lng: 'fr' | 'en'): Promise<TFunction> => {
    const instance = i18next.createInstance()
    await instance.init({ resources, lng, interpolation: { escapeValue: false } })
    return instance.t
  }

  test('the state carries the stored reason code of the root', () => {
    const roots = [
      { id: 'r', path: '/nas', state: 'unreachable', lastFileCount: 4, lastError: 'empty' },
    ] as const
    expect(libraryState(library({ roots: [...roots] }), undefined)).toEqual({
      kind: 'unreachable',
      path: '/nas',
      reason: 'empty',
    })
  })

  test('worded in the interface language, generic without a known reason', async () => {
    const fr = await translator('fr')
    const en = await translator('en')
    expect(rootErrorLabel(fr, 'empty')).toBe('Dossier vide')
    expect(rootErrorLabel(en, 'empty')).toBe('Folder empty')
    expect(rootErrorLabel(fr, 'not_found')).toBe('Dossier introuvable')
    expect(rootErrorLabel(en, 'no_media')).toBe('No videos left')
    expect(rootErrorLabel(fr, undefined)).toBe('Dossier introuvable')
    expect(rootErrorLabel(en, undefined)).toBe('Folder unreachable')
  })

  test('the notification reads the reason before the path', async () => {
    const en = await translator('en')
    const notification = {
      kind: 'library/root_unreachable',
      context: { path: '/mnt/nas', reason: 'io_error' },
    } as const
    expect(notificationDetail(notification, en, 'en')).toBe('Folder unreadable · /mnt/nas')
    expect(
      notificationDetail(
        { ...notification, context: { path: '/mnt/nas', reason: 'gone' } },
        en,
        'en',
      ),
    ).toBe('/mnt/nas')
  })
})
