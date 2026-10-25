import { describe, expect, test } from 'bun:test'

import { ok } from '@projo/shared'

import type { CatalogRepository, PlayableSource } from '../../core/catalog/catalog.ts'
import type { PlaybackSession } from '../../core/playback/session.ts'
import { directStreamFactory } from './direct-stream.ts'

const source: PlayableSource = {
  id: 'source-1',
  state: 'ready',
  libraryId: 'library-1',
  path: '/media/film.mp4',
  rootReachable: true,
  extension: 'mp4',
  sizeBytes: 1,
  mtime: 1,
  version: {},
}

const session: PlaybackSession = {
  id: 's1',
  profileId: 'profile-1',
  authSessionId: 'auth-1',
  accountId: 'account-1',
  sourceId: source.id,
  itemId: 'movie-1',
  mode: 'direct',
  burnIn: false,
  startedAt: new Date(0),
  lastHeartbeatAt: new Date(0),
  positionMs: 0,
}

const streamOf = (current: PlayableSource) =>
  directStreamFactory({
    authorize: () => ok(session),
    catalogRepository: { findSource: () => current } as unknown as CatalogRepository,
  })({ sessionId: 's1', accountId: 'account-1', profileId: 'profile-1', sourceId: source.id })

describe('directStream', () => {
  test('serves the file of a ready source', async () => {
    expect(await streamOf(source)).toEqual({
      ok: true,
      value: { path: '/media/film.mp4', mimeType: 'video/mp4' },
    })
  })

  test('a source no longer ready (missing, pending again, rejected) is not served', async () => {
    for (const state of ['missing', 'pending', 'rejected'] as const) {
      expect(await streamOf({ ...source, state })).toMatchObject({
        ok: false,
        error: { code: 'playback/source_unavailable' },
      })
    }
  })
})
