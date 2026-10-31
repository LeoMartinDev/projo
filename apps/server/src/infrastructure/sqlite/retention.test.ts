import { beforeEach, describe, expect, test } from 'bun:test'

import { insertImage, insertItem, insertLibrary } from '../../../test/support/catalog-fixtures.ts'
import { createTestDatabase } from '../../../test/support/database.ts'
import type { Db } from './database.ts'
import { createSqliteImageRepository } from './image-repository.ts'
import { createSqliteNotificationRepository } from './notification-repository.ts'
import { createSqliteScanRunRepository } from './scan-run-repository.ts'
import { itemOverrides, people } from './schema/items.ts'
import { scanRuns } from './schema/libraries.ts'
import { notifications } from './schema/ops.ts'
import { createSqliteTmdbResponseStore } from './tmdb-response-store.ts'

/** §18 "Rules": the stores that only grew are trimmed. */

const day = (n: number) => new Date(Date.UTC(2026, 9, n))

let db: Db
beforeEach(() => {
  db = createTestDatabase()
})

describe('retention', () => {
  test('unused images: neither an item slot, a cast photo nor a locked custom image', () => {
    for (const id of ['poster', 'locked', 'photo', 'orphan']) insertImage(db, id)
    insertItem(db, { id: 'movie', kind: 'movie', posterImageId: 'poster' })
    db.insert(itemOverrides)
      .values({ itemId: 'movie', field: 'poster_image_id', value: 'locked' })
      .run()
    db.insert(people).values({ id: 'p', tmdbId: 1, name: 'P', profileImageId: 'photo' }).run()
    expect(createSqliteImageRepository({ db }).listUnused()).toEqual(['orphan'])
  })

  test('TMDB responses fetched before the date', () => {
    const store = createSqliteTmdbResponseStore({ db })
    store.put({ key: 'movie/1', payload: {}, fetchedAt: day(1) })
    store.put({ key: 'movie/2', payload: {}, fetchedAt: day(20) })
    expect(store.purgeFetchedBefore(day(10))).toBe(1)
    expect(store.get('movie/1')).toBeUndefined()
    expect(store.get('movie/2')).toBeDefined()
  })

  test('notifications resolved before the date; open ones stay', () => {
    const insert = (id: string, resolvedAt?: Date) =>
      db
        .insert(notifications)
        .values({
          id,
          kind: 'cache/disk_low',
          severity: 'warning',
          titleKey: 'cache/disk_low',
          createdAt: day(1).toISOString(),
          ...(resolvedAt === undefined ? {} : { resolvedAt: resolvedAt.toISOString() }),
        })
        .run()
    insert('old', day(2))
    insert('recent', day(20))
    insert('open')
    expect(createSqliteNotificationRepository({ db }).purgeResolvedBefore(day(10))).toBe(1)
    expect(
      db
        .select({ id: notifications.id })
        .from(notifications)
        .all()
        .map((row) => row.id)
        .sort(),
    ).toEqual(['open', 'recent'])
  })

  test('scan runs finished before the date, except the latest of each library', () => {
    insertLibrary(db, { id: 'films' })
    insertLibrary(db, { id: 'shows', rootPath: '/shows' })
    const run = (id: string, libraryId: string, at: Date, finished = true) =>
      db
        .insert(scanRuns)
        .values({
          id,
          libraryId,
          kind: 'periodic',
          startedAt: at.toISOString(),
          ...(finished ? { finishedAt: at.toISOString() } : {}),
        })
        .run()
    run('films-1', 'films', day(1))
    run('films-2', 'films', day(2))
    run('films-3', 'films', day(20))
    run('shows-1', 'shows', day(1))
    run('shows-2', 'shows', day(3))
    expect(createSqliteScanRunRepository({ db }).purgeFinishedBefore(day(10))).toBe(3)
    expect(
      db
        .select({ id: scanRuns.id })
        .from(scanRuns)
        .all()
        .map((row) => row.id)
        .sort(),
    ).toEqual(['films-3', 'shows-2'])
  })
})
