import { beforeEach, describe, expect, test } from 'bun:test'

import { createTestDatabase } from '../../../test/support/database.ts'
import { createSequentialIds } from '../../../test/support/fakes.ts'
import type { TvProgrammeData } from '../../core/tv/guide.ts'
import { tvSearchWordsOf } from '../../core/tv/search.ts'
import type { Db } from './database.ts'
import { createSqliteTvGuideRepository } from './tv-guide-repository.ts'
import { createSqliteTvSearchReadModel } from './tv-search-read-model.ts'

const now = new Date('2026-11-18T20:00:00.000Z')
const minutes = (n: number) => new Date(now.getTime() + n * 60_000)

let db: Db

const insertChannels = () => {
  const client = db.$client
  // Sources sorted by name: "A" before "B", whatever their ids.
  client.run(`INSERT INTO tv_sources (id, kind, name, settings, created_at) VALUES
    ('sb', 'm3u', 'B', '{}', '2026-01-01T00:00:00.000Z'),
    ('sa', 'm3u', 'A', '{}', '2026-01-01T00:00:00.000Z')`)
  client.run(`INSERT INTO tv_groups (id, source_id, name, enabled, position) VALUES
    ('ga2', 'sa', 'Second', 1, 1), ('ga1', 'sa', 'First', 1, 0), ('gb', 'sb', '', 1, 0)`)
  const channel = client.prepare(
    `INSERT INTO tv_channels (id, source_id, key, name, search_name, number, group_id, position,
      upstream, enabled, missing_since, logo_path, created_at)
      VALUES (?1, ?2, ?1, ?3, lower(?3), ?4, ?5, ?6, '{}', ?7, ?8, ?9, '2026-01-01T00:00:00.000Z')`,
  )
  for (const row of [
    ['b1', 'sb', 'Téva', 20, 'gb', 0, 1, null, null],
    ['a3', 'sa', 'France 2', 2, 'ga2', 0, 1, null, 'tv/a3.png'],
    ['a2', 'sa', 'TF1', 1, 'ga1', 1, 1, null, 'tv/a2.png'],
    ['a1', 'sa', 'Arte', null, 'ga1', 0, 1, null, null],
    ['off', 'sa', 'Disabled', 3, 'ga1', 2, 0, null, null],
    ['gone', 'sa', 'Missing', 4, 'ga1', 3, 1, '2026-11-01T00:00:00.000Z', null],
  ] as const)
    channel.run(...row)
}

const programme = (
  channelId: string,
  title: string,
  from: number,
  to: number,
  extra: Partial<TvProgrammeData> = {},
): TvProgrammeData => ({
  channelId,
  title,
  startAt: minutes(from),
  endAt: minutes(to),
  categories: [],
  kind: 'other',
  ...extra,
})

beforeEach(() => {
  db = createTestDatabase()
  insertChannels()
  const guide = createSqliteTvGuideRepository({ db, ids: createSequentialIds('p') })
  // Written as a guide read writes them: `search_text` with them.
  guide.replaceForSource({
    sourceId: 'sa',
    now,
    programmes: [
      programme('a1', 'L’Été meurtrier', -30, 60, { kind: 'movie' }),
      programme('a2', 'Le journal de 20h', 0, 30, {
        subtitle: 'Édition spéciale',
        episode: { season: 2, episode: 5 },
      }),
      programme('a2', 'Ancien journal', -120, -10),
      programme('a3', 'Journal', 120, 150),
      programme('a3', 'Cœur de pirate', 200, 260),
      programme('off', 'Journal caché', -10, 30),
      programme('gone', 'Journal disparu', -10, 30),
    ],
  })
  guide.replaceForSource({
    sourceId: 'sb',
    now,
    programmes: [programme('b1', 'Le journal', 0, 30), programme('b1', 'Journal', 120, 150)],
  })
})

const titles = (query: string, limit = 20) =>
  createSqliteTvSearchReadModel({ db })
    .matchingProgrammes({ words: tvSearchWordsOf(query), at: now, limit })
    .map((found) => `${found.channelId} ${found.title}`)

describe('the TV search on SQLite (§29.6)', () => {
  test('channels: enabled and present only, in the viewer order (source, group, position)', () => {
    expect(createSqliteTvSearchReadModel({ db }).viewableChannels()).toEqual([
      { id: 'a1', name: 'Arte' },
      { id: 'a2', name: 'TF1', number: 1, logoPath: 'tv/a2.png' },
      { id: 'a3', name: 'France 2', number: 2, logoPath: 'tv/a3.png' },
      { id: 'b1', name: 'Téva', number: 20 },
    ])
  })

  test('programmes not ended: on now first, then by start, then in the channels order', () => {
    expect(titles('journal')).toEqual([
      'a2 Le journal de 20h',
      'b1 Le journal',
      'a3 Journal',
      'b1 Journal',
    ])
  })

  test('at most the limit', () => {
    expect(titles('journal', 2)).toEqual(['a2 Le journal de 20h', 'b1 Le journal'])
  })

  test('accents, case and ligatures ignored; title or subtitle; every word at a word start', () => {
    expect(titles('ETE')).toEqual(['a1 L’Été meurtrier'])
    expect(titles('meurt ét')).toEqual(['a1 L’Été meurtrier'])
    expect(titles('edition')).toEqual(['a2 Le journal de 20h'])
    expect(titles('journal spec')).toEqual(['a2 Le journal de 20h'])
    expect(titles('coeur')).toEqual(['a3 Cœur de pirate'])
    expect(titles('cœur')).toEqual(['a3 Cœur de pirate'])
    expect(titles('20')).toEqual(['a2 Le journal de 20h'])
    expect(titles('ournal')).toEqual([])
    expect(titles('journal pirate')).toEqual([])
    expect(titles('')).toEqual([])
  })

  test("a programme's fields as the search shows them", () => {
    const [found] = createSqliteTvSearchReadModel({ db }).matchingProgrammes({
      words: ['edition'],
      at: now,
      limit: 20,
    })
    expect(found).toEqual({
      id: expect.any(String),
      channelId: 'a2',
      title: 'Le journal de 20h',
      subtitle: 'Édition spéciale',
      episode: { season: 2, episode: 5 },
      kind: 'other',
      startAt: minutes(0),
      endAt: minutes(30),
    })
  })
})
