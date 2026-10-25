import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { missingSourcesAdminFactory } from '../../src/application/operations/maintenance.ts'
import { createSqliteMissingSourceRepository } from '../../src/infrastructure/sqlite/missing-source-repository.ts'
import { insertItem, insertLibrary, insertSource } from '../support/catalog-fixtures.ts'
import { silentLogger } from '../support/logger.ts'
import { createMetadataWorld, type MetadataWorld } from '../support/metadata-world.ts'

/**
 * §9.1 / §9.4: `items.metadata_language`, the deciding library of an item in two libraries, and the
 * refresh queued when the server language, a library language or its rating country changes.
 * Rows are seeded directly (no scan): only the metadata module and the TMDB replay server run.
 */
let world: MetadataWorld

beforeEach(async () => {
  world = createMetadataWorld()
  insertLibrary(world.db, { id: 'films', rootPath: '/films' })
  world.db.$client.run(`UPDATE libraries SET created_at = '2026-01-01' WHERE id = 'films'`)
  insertItem(world.db, {
    id: 'inception',
    kind: 'movie',
    title: 'Inception',
    tmdbId: 27205,
    metadataLanguage: 'fr-FR',
  })
  insertSource(world.db, {
    id: 'inception-file',
    itemId: 'inception',
    libraryId: 'films',
    rootId: 'films-root',
  })
  expect((await world.setKey()).status).toBe(200)
})
afterEach(() => world.stop())

const queuedRefreshes = () =>
  world.query<{ payload: string; priority: number }>(
    `SELECT payload, priority FROM jobs WHERE type = 'refresh_metadata' AND state = 'queued' ORDER BY id`,
  )
const languageOf = (id: string) =>
  world.query<{ metadata_language?: string }>(
    'SELECT metadata_language FROM items WHERE id = ?',
    id,
  )[0]?.metadata_language
const movieLanguages = () =>
  world.tmdb.callsTo('movie/27205').map((call) => call.params['language'])

describe('identification in a second library (§9.1)', () => {
  test('a file of a newer library: written in its language, then refreshed in the deciding one', async () => {
    insertLibrary(world.db, { id: 'kids', rootPath: '/kids', ratingCountry: 'US' })
    world.db.$client.run(
      `UPDATE libraries SET created_at = '2026-02-01', metadata_language = 'en-US' WHERE id = 'kids'`,
    )
    insertSource(world.db, {
      id: 'kids-file',
      libraryId: 'kids',
      rootId: 'kids-root',
      relativePath: 'Inception (2010).mkv',
      classification: 'movie',
      parsed: { title: 'Inception', year: 2010 },
      matchState: 'unmatched',
    })
    world.jobQueue.enqueue({ type: 'match_source', payload: { sourceId: 'kids-file' } })
    await world.runJobs(['match_source'])
    expect(
      world.query('SELECT item_id FROM source_items WHERE source_id = ?', 'kids-file'),
    ).toEqual([{ item_id: 'inception' }])
    expect(languageOf('inception')).toBe('en-US')
    expect(queuedRefreshes()).toEqual([{ payload: '{"itemId":"inception"}', priority: 10 }])
    await world.runJobs(['refresh_metadata'])
    expect(languageOf('inception')).toBe('fr-FR')
    expect(movieLanguages().slice(-1)).toEqual(['fr-FR'])
  })
})

describe('metadata language (§9.1, §9.4)', () => {
  test('a new server language refreshes, at low priority, what was written in another one', async () => {
    const patched = await world.request('/settings', {
      method: 'PATCH',
      json: { metadata: { language: 'en-US' } },
    })
    expect(patched.status).toBe(200)
    expect(queuedRefreshes()).toEqual([{ payload: '{"itemId":"inception"}', priority: 10 }])
    await world.runJobs(['refresh_metadata'])
    expect(movieLanguages()).toContain('en-US')
    expect(languageOf('inception')).toBe('en-US')
    // Up to date: the same language again queues nothing.
    await world.request('/settings', { method: 'PATCH', json: { metadata: { language: 'en-US' } } })
    expect(queuedRefreshes()).toEqual([])
  })

  test('a library language or rating country refreshes the items it decides', async () => {
    const language = await world.request('/libraries/films', {
      method: 'PATCH',
      json: { metadataLanguage: 'de-DE' },
    })
    expect(language.status).toBe(200)
    expect(queuedRefreshes()).toEqual([{ payload: '{"itemId":"inception"}', priority: 10 }])
    await world.runJobs(['refresh_metadata'])
    expect(languageOf('inception')).toBe('de-DE')

    const country = await world.request('/libraries/films', {
      method: 'PATCH',
      json: { ratingCountry: 'US' },
    })
    expect(country.status).toBe(200)
    expect(queuedRefreshes()).toEqual([{ payload: '{"itemId":"inception"}', priority: 10 }])
    await world.runJobs(['refresh_metadata'])
    expect(
      world.query<{ content_rating_country?: string }>(
        `SELECT content_rating_country FROM items WHERE id = 'inception'`,
      ),
    ).toEqual([{ content_rating_country: 'US' }])
  })

  test('in two libraries, the oldest one decides: a newer one changing nothing refreshes', async () => {
    insertLibrary(world.db, { id: 'kids', rootPath: '/kids', ratingCountry: 'US' })
    world.db.$client.run(`UPDATE libraries SET created_at = '2026-02-01' WHERE id = 'kids'`)
    insertSource(world.db, {
      id: 'inception-kids',
      itemId: 'inception',
      libraryId: 'kids',
      rootId: 'kids-root',
    })
    await world.request('/libraries/kids', { method: 'PATCH', json: { metadataLanguage: 'en-US' } })
    await world.request('/libraries/kids', { method: 'PATCH', json: { ratingCountry: 'DE' } })
    expect(queuedRefreshes()).toEqual([])
    await world.request('/libraries/films', {
      method: 'PATCH',
      json: { metadataLanguage: 'it-IT' },
    })
    await world.runJobs(['refresh_metadata'])
    expect(movieLanguages()).toContain('it-IT')
    expect(languageOf('inception')).toBe('it-IT')
  })
})

/** The Bear S01E0n in a library: an unmatched episode file, identified by `match_source`. */
const bearEpisode = (id: string, libraryId: string, episode: number) => {
  insertSource(world.db, {
    id,
    libraryId,
    rootId: `${libraryId}-root`,
    relativePath: `The Bear/Season 1/The Bear S01E0${episode}.mkv`,
    classification: 'episode',
    parsed: { series: 'The Bear', season: 1, episode },
    matchState: 'unmatched',
  })
  world.jobQueue.enqueue({ type: 'match_source', payload: { sourceId: id } })
}
const bearRows = () =>
  world.query<{ kind: string; metadata_language?: string; content_rating_country?: string }>(
    `SELECT kind, metadata_language, content_rating_country FROM items
     WHERE tmdb_id IS NOT NULL AND kind <> 'movie' ORDER BY kind, episode_number`,
  )
const bearRefresh = () => {
  const [series] = world.query<{ id: string }>(`SELECT id FROM items WHERE kind = 'series'`)
  return { payload: JSON.stringify({ itemId: series?.id }), priority: 10 }
}

describe('a tree in two libraries keeps one language and one rating country (§9.1)', () => {
  test('an older library joining a series identified in a newer one refreshes the whole tree', async () => {
    insertLibrary(world.db, { id: 'series', rootPath: '/series' })
    world.db.$client.run(`UPDATE libraries SET created_at = '2026-01-15' WHERE id = 'series'`)
    insertLibrary(world.db, { id: 'kids', rootPath: '/kids', ratingCountry: 'US' })
    world.db.$client.run(
      `UPDATE libraries SET created_at = '2026-02-01', metadata_language = 'en-US' WHERE id = 'kids'`,
    )
    bearEpisode('e1', 'kids', 1)
    await world.runJobs(['match_source'])
    // Only in "kids": it decides, nothing to refresh.
    expect(queuedRefreshes()).toEqual([])
    expect(bearRows()).toEqual([
      { kind: 'episode', metadata_language: 'en-US', content_rating_country: 'US' },
      { kind: 'season', metadata_language: 'en-US', content_rating_country: 'US' },
      { kind: 'series', metadata_language: 'en-US', content_rating_country: 'US' },
    ])

    // E02 in the older "series": written in its settings, which now decide the whole tree, E01
    // included (written before in English with a US rating).
    bearEpisode('e2', 'series', 2)
    await world.runJobs(['match_source'])
    expect(queuedRefreshes()).toEqual([bearRefresh()])
    await world.runJobs(['refresh_metadata'])
    const consistent = { metadata_language: 'fr-FR', content_rating_country: 'FR' }
    expect(bearRows()).toEqual([
      { kind: 'episode', ...consistent },
      { kind: 'episode', ...consistent },
      { kind: 'season', ...consistent },
      { kind: 'series', ...consistent },
    ])
    // A refresh queues nothing; a consistent tree is not refreshed at its next episode.
    expect(queuedRefreshes()).toEqual([])
    bearEpisode('e3', 'series', 3)
    await world.runJobs(['match_source'])
    expect(queuedRefreshes()).toEqual([])
    // Written in the settings of "kids": refreshed in the deciding ones.
    bearEpisode('e4', 'kids', 4)
    await world.runJobs(['match_source'])
    expect(queuedRefreshes()).toEqual([bearRefresh()])
    await world.runJobs(['refresh_metadata'])
    expect(new Set(bearRows().map((row) => row.metadata_language))).toEqual(new Set(['fr-FR']))
    expect(queuedRefreshes()).toEqual([])
  })
})

describe('the deciding library losing its files (§9.1, §9.4)', () => {
  /** Inception also in a newer library "kids" (US ratings, its own language when given). */
  const alsoInKids = (language?: string) => {
    insertLibrary(world.db, { id: 'kids', rootPath: '/kids', ratingCountry: 'US' })
    world.db.$client.run(`UPDATE libraries SET created_at = '2026-02-01' WHERE id = 'kids'`)
    if (language !== undefined)
      world.db.$client.run(`UPDATE libraries SET metadata_language = ? WHERE id = 'kids'`, [
        language,
      ])
    insertSource(world.db, {
      id: 'inception-kids',
      itemId: 'inception',
      libraryId: 'kids',
      rootId: 'kids-root',
      relativePath: 'Inception (2010).mkv',
    })
  }
  const inceptionRefresh = { payload: '{"itemId":"inception"}', priority: 10 }

  test('library deleted: refreshed for the next one, even when only its rating country differs', async () => {
    alsoInKids()
    insertLibrary(world.db, { id: 'teens', rootPath: '/teens', ratingCountry: 'DE' })
    world.db.$client.run(`UPDATE libraries SET created_at = '2026-03-01' WHERE id = 'teens'`)
    insertSource(world.db, {
      id: 'inception-teens',
      itemId: 'inception',
      libraryId: 'teens',
      rootId: 'teens-root',
      relativePath: 'Inception (2010).mkv',
    })
    // Not the deciding library: nothing changes.
    expect((await world.request('/libraries/teens', { method: 'DELETE' })).status).toBe(204)
    expect(queuedRefreshes()).toEqual([])
    expect((await world.request('/libraries/films', { method: 'DELETE' })).status).toBe(204)
    expect(queuedRefreshes()).toEqual([inceptionRefresh])
    await world.runJobs(['refresh_metadata'])
    expect(
      world.query(
        `SELECT metadata_language, content_rating_country FROM items WHERE id = 'inception'`,
      ),
    ).toEqual([{ metadata_language: 'fr-FR', content_rating_country: 'US' }])
  })

  test('root removed: refreshed in the language of the library deciding now', async () => {
    alsoInKids('en-US')
    world.db.$client.run(
      `INSERT INTO library_roots (id, library_id, path) VALUES ('films-extra', 'films', '/films-extra')`,
    )
    const patched = await world.request('/libraries/films', {
      method: 'PATCH',
      json: { roots: ['/films-extra'] },
    })
    expect(patched.status).toBe(200)
    expect(world.query(`SELECT id FROM sources WHERE id = 'inception-file'`)).toEqual([])
    expect(queuedRefreshes()).toEqual([inceptionRefresh])
    await world.runJobs(['refresh_metadata'])
    expect(languageOf('inception')).toBe('en-US')
  })

  test('missing files purged: refreshed for the next library, nothing once the last one goes', async () => {
    alsoInKids('en-US')
    world.db.$client.run(
      `UPDATE sources SET state = 'missing', missing_since = '2026-01-01T00:00:00.000Z'
       WHERE id IN ('inception-file', 'inception-kids')`,
    )
    const missing = missingSourcesAdminFactory({
      missingSources: createSqliteMissingSourceRepository({ db: world.db }),
      playbackSessions: { endWithin: () => {} },
      metadataContext: world.metadata.libraryMetadataContext,
      logger: silentLogger,
    })
    expect(missing.purge({ sourceId: 'inception-file' }).ok).toBe(true)
    expect(queuedRefreshes()).toEqual([inceptionRefresh])
    await world.runJobs(['refresh_metadata'])
    expect(languageOf('inception')).toBe('en-US')
    expect(missing.purge({ sourceId: 'inception-kids' }).ok).toBe(true)
    expect(queuedRefreshes()).toEqual([])
  })
})
