import { expect, test } from 'bun:test'

import { ok } from '@projo/shared'

import { createManualClock } from '../../../test/support/clock.ts'
import { createRecordingJobQueue } from '../../../test/support/fakes.ts'
import { silentLogger } from '../../../test/support/logger.ts'
import type { LibraryRepository } from '../../core/library/library.ts'
import type { ManualMatchRepository, MetadataSettings } from '../../core/metadata/ports.ts'
import type { Source, SourceRepository } from '../../core/source/source.ts'
import type { ApplyMatch } from './apply-match.ts'
import { matchSourceFactory } from './match-source.ts'
import type { ResolveMatch } from './resolve-match.ts'

const source = {
  id: 's1',
  libraryId: 'lib',
  relativePath: 'Film.mkv',
  state: 'ready',
  matchState: 'unmatched',
  classification: 'movie',
  parsed: { title: 'Film' },
} as Source

test('a match fixed by the admin while TMDB answers is left alone', async () => {
  let current = source
  const written: string[] = []
  const matchSource = matchSourceFactory({
    sourceRepository: { findById: () => current, patch: () => {} } as unknown as Pick<
      SourceRepository,
      'findById' | 'patch'
    >,
    libraryRepository: { findById: () => ({ id: 'lib' }) } as unknown as Pick<
      LibraryRepository,
      'findById'
    >,
    manualMatches: { findFor: () => undefined } as unknown as ManualMatchRepository,
    settings: { tmdbApiKey: () => 'key', language: () => 'en' } as unknown as MetadataSettings,
    resolveMatch: {
      resolve: async () => {
        // "To review": the admin assigns the file while the search runs.
        current = { ...source, matchState: 'manual' }
        return ok({ kind: 'review', reason: 'no_match' })
      },
    } as unknown as ResolveMatch,
    applyMatch: {
      review: () => void written.push('review'),
      apply: () => {
        written.push('apply')
        return { itemIds: [], enriched: [], topLevelId: 'i1' }
      },
    } as unknown as ApplyMatch,
    refresh: { queueIfContextDiffers: () => false },
    notifier: { notify: () => {}, resolve: () => {} },
    jobQueue: createRecordingJobQueue().queue,
    clock: createManualClock(),
    logger: silentLogger,
  })
  expect(await matchSource({ sourceId: 's1' })).toEqual(ok('skipped'))
  expect(written).toEqual([])
})
