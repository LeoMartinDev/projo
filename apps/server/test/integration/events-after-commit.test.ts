import { beforeEach, describe, expect, test } from 'bun:test'

import { endPlaybackSessionFactory } from '../../src/application/playback/end-playback-session.ts'
import { endPlaybackSessionsWithinFactory } from '../../src/application/playback/end-playback-sessions-within.ts'
import { linkSourceItemsFactory } from '../../src/application/scanner/link-source-items.ts'
import type { HlsSegmenter } from '../../src/core/playback/ports.ts'
import type { PlaybackScope } from '../../src/core/playback/session.ts'
import type { Platform } from '../../src/entrypoints/modules/platform.ts'
import { createSqliteLocalItemRepository } from '../../src/infrastructure/sqlite/local-item-repository.ts'
import { createSqlitePlaybackSessionRepository } from '../../src/infrastructure/sqlite/playback-session-repository.ts'
import { insertItem, insertLibrary, insertSource, seedViewer } from '../support/catalog-fixtures.ts'
import { silentLogger } from '../support/logger.ts'
import { createTestPlatform } from '../support/platform.ts'

/**
 * Linking a file to another title ends the playback sessions of the item it prunes, inside the
 * linking transaction: the player is told (`playback.session_terminated`) and ffmpeg stopped only
 * once the new links are committed, and neither happens when they roll back.
 */
describe('ending playback while linking a file', () => {
  let platform: Platform
  let seen: { links: string[]; inTransaction: boolean }[]
  let stopped: string[]
  let failAfterEnding: boolean

  const sessions = () => createSqlitePlaybackSessionRepository({ db: platform.db })

  const link = () => {
    const segmenter: HlsSegmenter = {
      segment: async () => {
        throw new Error('no streaming here')
      },
      stop: (id) => void stopped.push(id),
      stopAll: async () => {},
      sessionIds: () => [],
    }
    const endWithin = endPlaybackSessionsWithinFactory({
      sessionRepository: sessions(),
      endSession: endPlaybackSessionFactory({
        sessionRepository: sessions(),
        segmenter,
        eventBus: platform.eventBus,
        afterCommit: platform.afterCommit,
        clock: platform.clock,
        logger: silentLogger,
      }),
    })
    return linkSourceItemsFactory({
      localItems: createSqliteLocalItemRepository({ db: platform.db }),
      playbackSessions: {
        endWithin: (scope: PlaybackScope) => {
          endWithin(scope)
          if (failAfterEnding) throw new Error('failed after ending')
        },
      },
      ids: platform.ids,
      clock: platform.clock,
    })({
      id: 'source-1',
      matchState: 'unmatched',
      classification: 'movie',
      parsed: { title: 'Another Title', year: 2001 },
    })
  }

  const linksOfSource = () =>
    createSqliteLocalItemRepository({ db: platform.db })
      .linksOf('source-1')
      .map((entry) => entry.itemId)

  beforeEach(() => {
    platform = createTestPlatform()
    seen = []
    stopped = []
    failAfterEnding = false
    insertLibrary(platform.db)
    insertItem(platform.db, { id: 'old-item', kind: 'movie', title: 'Old Title' })
    insertSource(platform.db, { id: 'source-1', itemId: 'old-item' })
    const viewer = seedViewer(platform.db)
    sessions().insert({
      id: 'playback-1',
      profileId: viewer.profileId,
      authSessionId: viewer.authSessionId,
      sourceId: 'source-1',
      itemId: 'old-item',
      mode: 'direct',
      burnIn: false,
      startedAt: platform.clock.now(),
      lastHeartbeatAt: platform.clock.now(),
      positionMs: 0,
    })
    platform.eventBus.on('playback.session_terminated', () => {
      seen.push({ links: linksOfSource(), inTransaction: platform.db.$client.inTransaction })
    })
  })

  test('commit: the session ends, ffmpeg stops and the player is told after it', () => {
    const outcome = link()

    expect(outcome).toMatchObject({ kind: 'linked', changed: true })
    const linked = linksOfSource()
    expect(linked).not.toContain('old-item')
    expect(seen).toEqual([{ links: linked, inTransaction: false }])
    expect(stopped).toEqual(['playback-1'])
  })

  test('rollback: the session stays playable, ffmpeg untouched, nobody told', () => {
    failAfterEnding = true

    expect(link).toThrow('failed after ending')

    expect(linksOfSource()).toEqual(['old-item'])
    expect(sessions().findById('playback-1')?.endedAt).toBeUndefined()
    expect(stopped).toEqual([])
    expect(seen).toEqual([])
  })
})
