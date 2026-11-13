import { beforeEach, describe, expect, test } from 'bun:test'

import { linkSourceItemsFactory } from '../../src/application/scanner/link-source-items.ts'
import type { PlaybackScope } from '../../src/core/playback/session.ts'
import type { Platform } from '../../src/entrypoints/modules/platform.ts'
import { createSqliteLocalItemRepository } from '../../src/infrastructure/sqlite/local-item-repository.ts'
import { insertItem, insertLibrary, insertSource } from '../support/catalog-fixtures.ts'
import { createTestPlatform } from '../support/platform.ts'

/**
 * Linking a file to another title ends the playback sessions of the item it prunes, inside the
 * linking transaction: what the playback module's terminator publishes then must reach clients
 * and modules only once the new links are committed, and never when they roll back.
 */
describe('events published while linking a file', () => {
  let platform: Platform
  let seen: { links: string[]; inTransaction: boolean }[]
  let failEnding: boolean

  const link = () => {
    const localItems = createSqliteLocalItemRepository({ db: platform.db })
    const terminator = {
      endWithin: (_scope: PlaybackScope) => {
        platform.eventBus.publish('playback.session_terminated', {
          playbackSessionId: 'playback-1',
          sessionId: 'session-1',
          reason: 'admin',
        })
        if (failEnding) throw new Error('ending failed')
      },
    }
    return linkSourceItemsFactory({
      localItems,
      playbackSessions: terminator,
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
    failEnding = false
    insertLibrary(platform.db)
    insertItem(platform.db, { id: 'old-item', kind: 'movie', title: 'Old Title' })
    insertSource(platform.db, { id: 'source-1', itemId: 'old-item' })
    platform.eventBus.on('playback.session_terminated', () => {
      seen.push({ links: linksOfSource(), inTransaction: platform.db.$client.inTransaction })
    })
  })

  test('commit: delivered after it, the new links visible', () => {
    const outcome = link()

    expect(outcome).toMatchObject({ kind: 'linked', changed: true })
    const linked = linksOfSource()
    expect(linked).not.toContain('old-item')
    expect(seen).toEqual([{ links: linked, inTransaction: false }])
  })

  test('rollback: never delivered, the old links kept', () => {
    failEnding = true

    expect(link).toThrow('ending failed')

    expect(linksOfSource()).toEqual(['old-item'])
    expect(seen).toEqual([])
  })
})
