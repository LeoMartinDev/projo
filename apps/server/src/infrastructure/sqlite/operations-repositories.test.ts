import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync } from 'node:fs'

import { eq } from 'drizzle-orm'

import {
  insertItem,
  insertLibrary,
  insertSource,
  seedViewer,
} from '../../../test/support/catalog-fixtures.ts'
import { createTempDir, createTestDatabase } from '../../../test/support/database.ts'
import { settingKeys } from '../../core/settings/settings.ts'
import type { Db } from './database.ts'
import { createSqliteDatabaseExporter } from './database-exporter.ts'
import { createSqliteJobAdminRepository } from './job-admin-repository.ts'
import { createSqliteJobRepository } from './job-repository.ts'
import { createSqliteJobTargetLabels } from './job-target-labels.ts'
import { createSqliteMissingSourceRepository } from './missing-source-repository.ts'
import { createSqliteNotificationRepository } from './notification-repository.ts'
import {
  createSqlitePlaybackSettings,
  createSqlitePlaybackSettingsWriter,
} from './playback-settings.ts'
import { itemOverrides, items, manualMatches } from './schema/items.ts'
import { scanRuns, sources } from './schema/libraries.ts'
import { jobs, notifications, settings } from './schema/ops.ts'
import { playbackSessions } from './schema/playback.ts'
import {
  createSqliteNeedsReviewReminderStore,
  createSqliteServerNameStore,
} from './settings-values.ts'
import { createSqliteSourceRepository } from './source-repository.ts'
import { createSqliteStatsQueries } from './stats-queries.ts'

const t0 = new Date('2026-10-24T12:00:00.000Z')
const iso = (offsetMs = 0) => new Date(t0.getTime() + offsetMs).toISOString()
const uuid = (n: number) => `00000000-0000-7000-8000-${String(n).padStart(12, '0')}`

let db: Db
beforeEach(() => {
  db = createTestDatabase()
})

describe('notification repository (§15 "Notifications")', () => {
  const insert = (
    n: number,
    kind: string,
    extra: Partial<typeof notifications.$inferInsert> = {},
  ) =>
    db
      .insert(notifications)
      .values({
        id: uuid(n),
        kind,
        severity: 'warning',
        titleKey: kind,
        context: { key: `k${n}` },
        createdAt: iso(n),
        ...extra,
      })
      .run()

  test('lists newest first by status, pages by cursor, counts unread', () => {
    insert(1, 'cache/disk_low')
    insert(2, 'job/failed', { readAt: iso(10) })
    insert(3, 'library/root_unreachable', { resolvedAt: iso(20) })
    insert(4, 'scan/needs_review_count')
    insert(5, 'some/future_kind')
    const repository = createSqliteNotificationRepository({ db })
    expect(repository.unreadCount()).toBe(2)
    expect(repository.list({ limit: 10 }).items.map((n) => n.id)).toEqual([
      uuid(4),
      uuid(3),
      uuid(2),
      uuid(1),
    ])
    expect(repository.list({ status: 'unread', limit: 10 }).items.map((n) => n.id)).toEqual([
      uuid(4),
      uuid(1),
    ])
    expect(repository.list({ status: 'read', limit: 10 }).items.map((n) => n.kind)).toEqual([
      'job/failed',
    ])
    expect(repository.list({ status: 'resolved', limit: 10 }).items[0]).toMatchObject({
      kind: 'library/root_unreachable',
      resolvedAt: new Date(iso(20)),
      context: { key: 'k3' },
    })
    const first = repository.list({ limit: 2 })
    expect(first.nextCursor).toBe(uuid(4))
    expect(repository.list({ limit: 2, cursor: uuid(4) }).items.map((n) => n.id)).toEqual([
      uuid(3),
      uuid(2),
    ])
  })

  test('marks read once (idempotent), unknown ids are undefined', () => {
    insert(1, 'cache/disk_low')
    const repository = createSqliteNotificationRepository({ db })
    expect(repository.markRead({ id: uuid(1), at: t0 })?.readAt).toEqual(t0)
    expect(repository.markRead({ id: uuid(1), at: new Date(iso(5000)) })?.readAt).toEqual(t0)
    expect(repository.unreadCount()).toBe(0)
    expect(repository.markRead({ id: 'nope', at: t0 })).toBeUndefined()
  })
})

describe('job admin repository (§15 "Jobs")', () => {
  const insertJob = (n: number, values: Partial<typeof jobs.$inferInsert> = {}) =>
    db
      .insert(jobs)
      .values({
        id: uuid(n),
        type: 'probe_source',
        payload: { sourceId: `s${n}` },
        priority: 70,
        state: 'queued',
        attempts: 0,
        maxAttempts: 3,
        runAfter: iso(),
        ...values,
      })
      .run()

  test('lists newest first, filtered by state and type, with a cursor', () => {
    insertJob(1, { state: 'failed', error: { code: 'media/probe_failed', message: 'x' } })
    insertJob(2, { type: 'scan_library', payload: { libraryId: 'l' } })
    insertJob(3, { state: 'done' })
    insertJob(4, { type: 'not_a_job_anymore' })
    const repository = createSqliteJobAdminRepository({ db })
    expect(repository.list({ limit: 10 }).items.map((job) => job.id)).toEqual([
      uuid(3),
      uuid(2),
      uuid(1),
    ])
    expect(repository.list({ limit: 10, state: 'failed' }).items).toMatchObject([
      { id: uuid(1), error: { code: 'media/probe_failed' } },
    ])
    expect(repository.list({ limit: 10, type: 'scan_library' }).items).toHaveLength(1)
    const page = repository.list({ limit: 1, cursor: uuid(3) })
    expect(page).toMatchObject({ items: [{ id: uuid(2) }], nextCursor: uuid(2) })
  })

  test('a code another version wrote is kept as is', () => {
    insertJob(1, { state: 'failed', error: { code: 'old/removed_code', message: 'gone' } })
    expect(createSqliteJobAdminRepository({ db }).list({ limit: 1 }).items[0]?.error).toEqual({
      code: 'old/removed_code',
      message: 'gone',
    } as never)
  })

  test('retry: failed or cancelled back to queued, attempts and error cleared', () => {
    insertJob(1, {
      state: 'failed',
      attempts: 3,
      finishedAt: iso(),
      progress: 40,
      error: { code: 'media/probe_failed', message: 'x' },
    })
    insertJob(2, { state: 'running', attempts: 1 })
    const repository = createSqliteJobAdminRepository({ db })
    const later = new Date(iso(60_000))
    const retried = repository.retry({ id: uuid(1), now: later })
    expect(retried).toMatchObject({ state: 'queued', attempts: 0, runAfter: later })
    expect(retried?.error).toBeUndefined()
    expect(retried?.finishedAt).toBeUndefined()
    expect(retried?.progress).toBeUndefined()
    expect(repository.retry({ id: uuid(2), now: later })).toBeUndefined()
    // The runner can claim it again.
    expect(
      createSqliteJobRepository({ db }).claimNext({ types: ['probe_source'], now: later })?.id,
    ).toBe(uuid(1))
  })

  test('counts the jobs failed for good since a date', () => {
    insertJob(1, { state: 'failed', finishedAt: iso(-2 * 86_400_000) })
    insertJob(2, { state: 'failed', finishedAt: iso(-3_600_000) })
    insertJob(3, { state: 'done', finishedAt: iso(-60_000) })
    expect(
      createSqliteJobAdminRepository({ db }).countFailedSince(new Date(iso(-86_400_000))),
    ).toBe(1)
  })
})

describe('job target labels', () => {
  test('names libraries, files and versions; items by their parts, with their series', () => {
    insertLibrary(db, { id: 'lib' })
    insertSource(db, {
      id: 'src',
      libraryId: 'lib',
      rootId: 'lib-root',
      relativePath: 'Films/Dune (2021).mkv',
    })
    insertItem(db, { id: 'movie', kind: 'movie', title: 'Dune' })
    insertItem(db, { id: 'series', kind: 'series', title: 'Severance' })
    insertItem(db, {
      id: 'season',
      kind: 'season',
      parentId: 'series',
      title: 'Season 2',
      seasonNumber: 2,
    })
    insertItem(db, {
      id: 'episode',
      kind: 'episode',
      parentId: 'season',
      title: 'Goodbye',
      seasonNumber: 2,
      episodeNumber: 4,
    })
    // §6.3: a generic name is no title of its own.
    insertItem(db, {
      id: 'untitled',
      kind: 'episode',
      parentId: 'season',
      title: 'Episode 5',
      seasonNumber: 2,
      episodeNumber: 5,
    })
    const labels = createSqliteJobTargetLabels({ db }).labelsOf([
      { kind: 'library', id: 'lib' },
      { kind: 'source', id: 'src' },
      { kind: 'item', id: 'movie' },
      { kind: 'item', id: 'episode' },
      { kind: 'item', id: 'untitled' },
      { kind: 'season', id: 'season' },
      { kind: 'version', id: '1.2.0' },
      { kind: 'item', id: 'gone' },
    ])
    const season = { kind: 'season', seriesTitle: 'Severance', seasonNumber: 2 } as const
    expect(Object.fromEntries(labels)).toEqual({
      'library:lib': { label: 'lib' },
      'source:src': { label: 'Dune (2021).mkv' },
      'item:movie': { item: { kind: 'movie', title: 'Dune' } },
      'item:episode': {
        item: {
          kind: 'episode',
          title: 'Goodbye',
          seriesTitle: 'Severance',
          seasonNumber: 2,
          episodeNumber: 4,
        },
      },
      'item:untitled': {
        item: { kind: 'episode', seriesTitle: 'Severance', seasonNumber: 2, episodeNumber: 5 },
      },
      'season:season': { item: season },
      'item:season': { item: season },
      'version:1.2.0': { label: '1.2.0' },
    })
  })
})

describe('stats queries (§15 "Tableau de bord")', () => {
  test('counts visible items and sources by state', () => {
    insertLibrary(db)
    insertItem(db, { id: 'movie-ready', kind: 'movie' })
    insertItem(db, { id: 'movie-missing', kind: 'movie' })
    insertItem(db, { id: 'series', kind: 'series' })
    insertItem(db, { id: 'season', kind: 'season', parentId: 'series', seasonNumber: 1 })
    insertItem(db, { id: 'e1', kind: 'episode', parentId: 'season', episodeNumber: 1 })
    insertItem(db, { id: 'e2', kind: 'episode', parentId: 'season', episodeNumber: 2 })
    insertItem(db, { id: 'empty-series', kind: 'series' })
    insertSource(db, { id: 's1', itemId: 'movie-ready' })
    insertSource(db, { id: 's2', itemId: 'movie-missing', state: 'missing' })
    insertSource(db, { id: 's3', itemId: 'e1' })
    insertSource(db, { id: 's4', itemId: 'e2', matchState: 'needs_review' })
    insertSource(db, { id: 's5', state: 'pending', pendingReason: 'growing' })
    expect(createSqliteStatsQueries({ db }).counts()).toEqual({
      movies: 1,
      series: 1,
      episodes: 2,
      pendingSources: 1,
      needsReview: 1,
      missingSources: 1,
    })
  })

  test('running scans and active playback sessions', () => {
    const viewer = seedViewer(db, 'leo')
    insertLibrary(db, { id: 'lib' })
    db.insert(scanRuns)
      .values([
        { id: 'run-1', libraryId: 'lib', kind: 'manual_full', startedAt: iso() },
        {
          id: 'run-0',
          libraryId: 'lib',
          kind: 'periodic',
          startedAt: iso(-60_000),
          finishedAt: iso(-30_000),
        },
      ])
      .run()
    insertItem(db, { id: 'movie', kind: 'movie' })
    insertSource(db, { id: 'src', itemId: 'movie', libraryId: 'lib', rootId: 'lib-root' })
    for (const [id, endedAt] of [
      ['p1', null],
      ['p2', iso()],
    ] as const)
      db.insert(playbackSessions)
        .values({
          id,
          profileId: viewer.profileId,
          sessionId: viewer.authSessionId,
          sourceId: 'src',
          itemId: 'movie',
          mode: 'direct',
          startedAt: iso(),
          lastHeartbeatAt: iso(),
          positionMs: 0,
          endedAt,
        })
        .run()
    const queries = createSqliteStatsQueries({ db })
    expect(queries.runningScans()).toEqual([
      {
        libraryId: 'lib',
        libraryName: 'lib',
        scanRunId: 'run-1',
        kind: 'manual_full',
        startedAt: t0,
      },
    ])
    expect(queries.activePlaybackSessions()).toBe(1)
  })
})

describe('admin source list: linked items (§15 "Manquants")', () => {
  test('names the items of each source, episodes with their series', () => {
    insertLibrary(db)
    insertItem(db, { id: 'series', kind: 'series', title: 'Severance' })
    insertItem(db, { id: 'season', kind: 'season', parentId: 'series', seasonNumber: 1 })
    insertItem(db, {
      id: 'e1',
      kind: 'episode',
      parentId: 'season',
      title: 'Good News',
      seasonNumber: 1,
      episodeNumber: 1,
    })
    insertSource(db, { id: 's1', itemId: 'e1', state: 'missing', missingSince: iso() })
    insertSource(db, { id: 's2', state: 'missing', missingSince: iso() })
    const page = createSqliteSourceRepository({
      db,
      ids: { next: () => 'unused' },
    }).page({ state: 'missing', limit: 10 })
    expect(page.items.map((source) => [source.id, source.items])).toEqual([
      ['s2', []],
      [
        's1',
        [
          {
            id: 'e1',
            kind: 'episode',
            title: 'Good News',
            seriesTitle: 'Severance',
            seasonNumber: 1,
            episodeNumber: 1,
          },
        ],
      ],
    ])
  })
})

describe('missing source repository (§7.5 purge)', () => {
  beforeEach(() => {
    insertLibrary(db)
  })
  const exists = (id: string) =>
    db.select({ id: items.id }).from(items).where(eq(items.id, id)).get() !== undefined

  test('lists missing sources, by library and by age', () => {
    insertLibrary(db, { id: 'other', rootPath: '/other' })
    insertSource(db, { id: 'old', state: 'missing', missingSince: iso(-40 * 86_400_000) })
    insertSource(db, { id: 'new', state: 'missing', missingSince: iso(-86_400_000) })
    insertSource(db, {
      id: 'elsewhere',
      libraryId: 'other',
      rootId: 'other-root',
      state: 'missing',
      missingSince: iso(),
    })
    insertSource(db, { id: 'ready' })
    const repository = createSqliteMissingSourceRepository({ db })
    expect(repository.listMissingIds({}).sort()).toEqual(['elsewhere', 'new', 'old'])
    expect(repository.listMissingIds({ libraryId: 'library-1' }).sort()).toEqual(['new', 'old'])
    expect(repository.listMissingIds({ missingBefore: new Date(iso(-30 * 86_400_000)) })).toEqual([
      'old',
    ])
    expect(repository.stateOf('ready')).toBe('ready')
    expect(repository.stateOf('nope')).toBeUndefined()
  })

  test('deletes the source, then the items left without source, then emptied parents', () => {
    insertItem(db, { id: 'series', kind: 'series', tmdbId: 1 })
    insertItem(db, { id: 'season', kind: 'season', parentId: 'series', seasonNumber: 1 })
    insertItem(db, { id: 'e1', kind: 'episode', parentId: 'season', episodeNumber: 1 })
    insertSource(db, { id: 'gone', itemId: 'e1', state: 'missing', missingSince: iso() })
    expect(createSqliteMissingSourceRepository({ db }).purge(['gone'])).toEqual({
      purged: 1,
      deletedItems: 3,
    })
    expect(['series', 'season', 'e1'].some(exists)).toBe(false)
  })

  test('keeps items with another source, a sibling, an override or a manual identification', () => {
    insertItem(db, { id: 'movie-two-versions', kind: 'movie' })
    insertSource(db, { id: 'v1', itemId: 'movie-two-versions', state: 'missing' })
    insertSource(db, { id: 'v2', itemId: 'movie-two-versions' })
    insertItem(db, { id: 'series', kind: 'series' })
    insertItem(db, { id: 'season', kind: 'season', parentId: 'series', seasonNumber: 1 })
    insertItem(db, { id: 'e1', kind: 'episode', parentId: 'season', episodeNumber: 1 })
    insertItem(db, { id: 'e2', kind: 'episode', parentId: 'season', episodeNumber: 2 })
    insertSource(db, { id: 'e1-file', itemId: 'e1', state: 'missing' })
    insertSource(db, { id: 'e2-file', itemId: 'e2' })
    insertItem(db, { id: 'edited', kind: 'movie' })
    db.insert(itemOverrides).values({ itemId: 'edited', field: 'title', value: 'Mine' }).run()
    insertSource(db, { id: 'edited-file', itemId: 'edited', state: 'missing' })
    insertItem(db, { id: 'identified', kind: 'movie', tmdbId: 438631 })
    insertSource(db, { id: 'identified-file', itemId: 'identified', state: 'missing' })
    db.insert(manualMatches)
      .values({
        libraryId: 'library-1',
        relativePath: 'identified-file.mkv',
        sourceId: 'identified-file',
        tmdbId: 438631,
        kind: 'movie',
        createdBy: 'leo',
        createdAt: iso(),
      })
      .run()
    insertSource(db, { id: 'ready-file', state: 'ready' })

    const result = createSqliteMissingSourceRepository({ db }).purge([
      'v1',
      'e1-file',
      'edited-file',
      'identified-file',
      'ready-file',
    ])
    expect(result).toEqual({ purged: 4, deletedItems: 1 })
    expect(exists('movie-two-versions')).toBe(true)
    expect(exists('e1')).toBe(false)
    expect(['series', 'season', 'e2'].every(exists)).toBe(true)
    expect(exists('edited')).toBe(true)
    expect(exists('identified')).toBe(true)
    // The correction stays, without its source (§6.3 `manual_matches`).
    expect(db.select().from(manualMatches).get()?.sourceId).toBeNull()
    expect(
      db
        .select({ id: sources.id })
        .from(sources)
        .all()
        .map((row) => row.id)
        .sort(),
    ).toEqual(['e2-file', 'ready-file', 'v2'])
  })
})

describe('settings writers', () => {
  test('playback settings: written values are read back, others keep their default', () => {
    createSqlitePlaybackSettingsWriter({ db }).write({
      values: { maxConcurrentTranscodes: 5, audioDownmix: 'keep', trickplayEnabled: false },
      at: t0,
    })
    expect(createSqlitePlaybackSettings({ db }).read()).toEqual({
      audioDownmix: 'keep',
      maxConcurrentTranscodes: 5,
      transcodeCacheMaxGb: 10,
      burnInEnabled: true,
      trickplayEnabled: false,
      hwAccel: 'off',
    })
  })

  test('server name: `projo` until set', () => {
    const store = createSqliteServerNameStore({ db })
    expect(store.read()).toBe('projo')
    store.write({ name: 'Maison', at: t0 })
    expect(store.read()).toBe('Maison')
    expect(
      db.select().from(settings).where(eq(settings.key, settingKeys.serverName)).get()?.value,
    ).toBe('Maison')
  })

  test('needs-review reminder date', () => {
    const store = createSqliteNeedsReviewReminderStore({ db })
    expect(store.read()).toBeUndefined()
    store.write(t0)
    expect(store.read()).toEqual(t0)
  })
})

describe('database exporter (§5.4)', () => {
  let temp: ReturnType<typeof createTempDir>
  beforeEach(() => {
    temp = createTempDir()
  })
  afterEach(() => {
    temp.cleanup()
  })

  test('VACUUM INTO a new file; an existing file is refused', () => {
    insertLibrary(db)
    const exporter = createSqliteDatabaseExporter({ db })
    const file = `${temp.path}/export.db`.replaceAll('\\', '/')
    const result = exporter.exportTo(file)
    expect(result.ok).toBe(true)
    expect(result.ok && result.value.sizeBytes).toBeGreaterThan(0)
    expect(existsSync(file)).toBe(true)
    expect(exporter.exportTo(file)).toMatchObject({
      ok: false,
      error: { code: 'db/export_failed' },
    })
  })
})
