import { expect, test } from 'bun:test'

import { appError, err, ok } from '@projo/shared'

import { createManualClock } from '../../../test/support/clock.ts'
import {
  createRecordingEventBus,
  createRecordingJobQueue,
  createSequentialIds,
} from '../../../test/support/fakes.ts'
import { silentLogger } from '../../../test/support/logger.ts'
import type { Library, LibraryRepository } from '../../core/library/library.ts'
import type { ScanRun, ScanRunRepository } from '../../core/scanner/ports.ts'
import type { SourceRepository, SourceSnapshot } from '../../core/source/source.ts'
import { scanLibraryFactory } from './scan-library.ts'
import type { WalkResult } from './walk-root.ts'

const library = {
  id: 'lib',
  roots: [{ id: 'root', libraryId: 'lib', path: '/media', state: 'ok', lastFileCount: 1 }],
} as unknown as Library

/** Known at its old place, signed: a file of the same size elsewhere is probed as its move. */
const film = {
  id: 's1',
  libraryId: 'lib',
  rootId: 'root',
  relativePath: 'Old/Film.mkv',
  state: 'ready',
  sizeBytes: 3_000_000,
  mtimeMs: 10,
  inode: '1:1',
  signature: 'sig',
  matchState: 'matched',
  classification: 'movie',
  parsed: { title: 'Film' },
} as SourceSnapshot

const walk: WalkResult = {
  videos: [{ rootId: 'root', relativePath: 'New/Film.mkv', sizeBytes: 3_000_000, mtimeMs: 10 }],
  subtitles: [],
  directories: new Set(['', 'New']),
  failedDirectories: [],
  failedFiles: [],
  unsupportedLayouts: [],
  rootEntryCount: 1,
  errors: 0,
  aborted: false,
}

test('a scan stopped while it probes moved files applies nothing', async () => {
  const controller = new AbortController()
  const applied: unknown[] = []
  let finished: ScanRun | undefined
  const scanRuns: Pick<ScanRunRepository, 'start' | 'finish'> = {
    start: (run) => ({ ...run, stats: {} }) as ScanRun,
    finish: ({ id, finishedAt, stats, error }) => {
      finished = {
        id,
        libraryId: 'lib',
        kind: 'manual_quick',
        startedAt: finishedAt,
        stats,
        ...(error === undefined ? {} : { error }),
      }
      return finished
    },
  }
  const scanLibrary = scanLibraryFactory({
    libraryRepository: {
      findById: () => library,
      markRootScanned: () => {},
    } as unknown as LibraryRepository,
    sourceRepository: {
      listSnapshots: () => [film],
      applyChanges: (changes: unknown) => void applied.push(changes),
      externalSubtitlesByLibrary: () => new Map(),
      replaceExternalSubtitles: () => {},
      findById: () => undefined,
    } as unknown as SourceRepository,
    scanRunRepository: scanRuns as ScanRunRepository,
    walkRoot: async () => walk,
    fileSystem: {
      stat: async () => ok({ kind: 'directory', sizeBytes: 0, mtimeMs: 0, inode: '1:2' }),
      readDirectory: async () => ok([]),
      realPath: async (path) => ok(path),
    },
    prober: {
      // A restart: the runner aborts the job, ffprobe is killed.
      probe: async () => {
        controller.abort()
        return err(appError('media/ffmpeg_failed', 'killed'))
      },
    },
    linkSourceItems: () => ({ kind: 'kept' }),
    requestMatch: () => {},
    notifier: { notify: () => {}, resolve: () => {} },
    jobQueue: createRecordingJobQueue().queue,
    eventBus: createRecordingEventBus().bus,
    clock: createManualClock(),
    ids: createSequentialIds('run-'),
    logger: silentLogger,
  })
  const result = await scanLibrary({
    libraryId: 'lib',
    kind: 'manual_quick',
    signal: controller.signal,
  })
  expect(result.ok).toBe(true)
  expect(finished?.error).toBe('job/cancelled')
  expect(applied).toEqual([])
})
