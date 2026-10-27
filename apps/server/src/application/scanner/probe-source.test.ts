import { describe, expect, test } from 'bun:test'

import { appError, err, ok } from '@projo/shared'

import { createManualClock } from '../../../test/support/clock.ts'
import { createRecordingEventBus } from '../../../test/support/fakes.ts'
import { silentLogger } from '../../../test/support/logger.ts'
import type { MediaError } from '../../core/media/probe.ts'
import type { Source, SourcePatch, SourceRepository } from '../../core/source/source.ts'
import { probeSourceFactory } from './probe-source.ts'

const source = {
  id: 's1',
  libraryId: 'lib',
  relativePath: 'Film.mkv',
  state: 'ready',
  sizeBytes: 3_000_000,
  mtimeMs: 10,
  matchState: 'matched',
  signature: 'old',
} as Source

const setup = (probeError: MediaError) => {
  const patches: SourcePatch[] = []
  const sourceRepository = {
    findById: () => source,
    absolutePathOf: () => '/media/Film.mkv',
    patch: (_id: string, patch: SourcePatch) => patches.push(patch),
  } as unknown as SourceRepository
  const probeSource = probeSourceFactory({
    sourceRepository,
    fileSystem: {
      stat: async () => ok({ kind: 'file', sizeBytes: 3_000_000, mtimeMs: 10, inode: '1:1' }),
      readDirectory: async () => ok([]),
      realPath: async (path) => ok(path),
    },
    prober: { probe: async () => err(probeError) },
    decoder: { decodeSample: async () => ok() },
    linkSourceItems: () => ({ kind: 'kept' }),
    requestMatch: () => {},
    notifier: { notify: () => {}, resolve: () => {} },
    eventBus: createRecordingEventBus().bus,
    clock: createManualClock(),
    logger: silentLogger,
  })
  return { probeSource, patches }
}

describe('probe_source failures that say nothing about the file', () => {
  test('an interrupted probe is job/cancelled and leaves the source as it was', async () => {
    const { probeSource, patches } = setup(appError('media/ffmpeg_failed', 'ffprobe aborted'))
    const controller = new AbortController()
    controller.abort()
    expect(
      await probeSource({ sourceId: 's1', mode: 'verify', signal: controller.signal }),
    ).toMatchObject({ ok: false, error: { code: 'job/cancelled' } })
    expect(patches).toEqual([])
  })

  test.each(['media/timeout', 'media/binary_missing'] as const)(
    '%s fails the job (retried) without touching the source',
    async (code) => {
      const { probeSource, patches } = setup(appError(code, 'tool failure'))
      expect(await probeSource({ sourceId: 's1', mode: 'verify' })).toMatchObject({
        ok: false,
        error: { code },
      })
      expect(patches).toEqual([])
    },
  )

  test('a broken file still goes back to pending', async () => {
    const { probeSource, patches } = setup(appError('media/ffprobe_failed', 'unreadable'))
    expect(await probeSource({ sourceId: 's1', mode: 'verify' })).toEqual(ok('probe_failed'))
    expect(patches).toMatchObject([{ state: 'pending', pendingReason: 'probe_failed' }])
  })
})
