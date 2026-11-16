import { afterEach, beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test'

import type {
  RejectGroupResponse,
  ReviewGroupFilesResponse,
  ReviewGroupsPage,
} from '@projo/shared/api/libraries'
import type { AssignResponse } from '@projo/shared/api/metadata'

import { insertItem, insertLibrary, insertSource } from '../support/catalog-fixtures.ts'
import { createMetadataWorld, type MetadataWorld } from '../support/metadata-world.ts'

setDefaultTimeout(90_000)

let world: MetadataWorld
beforeEach(() => {
  world = createMetadataWorld()
})
afterEach(async () => {
  await world.stop()
})

const sourceRow = (id: string) =>
  world.query<{ match_state: string; review_reason?: string; state: string }>(
    'SELECT match_state, review_reason, state FROM sources WHERE id = ?',
    id,
  )[0]
const linksOf = (sourceId: string) =>
  world
    .query<{ item_id: string }>('SELECT item_id FROM source_items WHERE source_id = ?', sourceId)
    .map((row) => row.item_id)

/**
 * "Ours" as the scanner leaves it: a local show, season 1, episodes 1, 2 and 9 (TMDB's season
 * has 8), plus a file of the same folder without a number (never linked to an episode), a copy
 * in another show folder, a movie and a file of another show. Ids grow with the order of
 * insertion, so the list (newest first) reads them backwards.
 */
const seed = () => {
  insertLibrary(world.db)
  insertItem(world.db, { id: 'local-ours', kind: 'series', title: 'Ours' })
  insertItem(world.db, {
    id: 'local-ours-s1',
    kind: 'season',
    parentId: 'local-ours',
    seasonNumber: 1,
  })
  for (const episode of [1, 2, 3, 9]) {
    insertItem(world.db, {
      id: `local-ours-e${episode}`,
      kind: 'episode',
      parentId: 'local-ours-s1',
      seasonNumber: 1,
      episodeNumber: episode,
    })
  }
  const toReview = (
    id: string,
    relativePath: string,
    extra: Partial<Parameters<typeof insertSource>[1]> = {},
  ) =>
    insertSource(world.db, {
      id,
      relativePath,
      classification: 'episode',
      matchState: 'needs_review',
      reviewReason: 'no_match',
      ...extra,
    })
  toReview('s01-e09', 'Ours/Season 1/Ours.S01E09.mkv', {
    itemId: 'local-ours-e9',
    parsed: { series: 'Ours', season: 1, episode: 9 },
  })
  toReview('s02-e01', 'Ours/Season 1/Ours.S01E01.mkv', {
    itemId: 'local-ours-e1',
    parsed: { series: 'Ours', season: 1, episode: 1 },
  })
  toReview('s03-special', 'Ours/Season 1/Ours.Special.mkv', {
    parsed: { series: 'Ours', season: 1 },
    reviewReason: 'no_episode_number',
  })
  toReview('s04-e02', 'Ours/Season 1/Ours.S01E02.mkv', {
    itemId: 'local-ours-e2',
    parsed: { series: 'Ours', season: 1, episode: 2 },
    reviewReason: 'episode_not_found',
  })
  toReview('s05-copy', 'Rangement/Ours/Season 1/Ours.S01E03.mkv', {
    itemId: 'local-ours-e3',
    parsed: { series: 'Ours', season: 1, episode: 3 },
  })
  insertItem(world.db, { id: 'local-dune', kind: 'movie', title: 'Dune' })
  toReview('s06-dune', 'Dune.mkv', {
    itemId: 'local-dune',
    classification: 'movie',
    parsed: { title: 'Dune' },
    reviewReason: 'ambiguous_match',
  })
}

const getJson = async <T>(path: string): Promise<T> => {
  const response = await world.request(path)
  expect(response.status).toBe(200)
  return (await response.json()) as T
}

describe('"To review" by series group (§7.8)', () => {
  test('one row per group in the order of files; pages follow the cursor', async () => {
    seed()
    const page = await getJson<ReviewGroupsPage>('/sources/review-groups')
    expect(page.total).toBe(6)
    expect(page.items.map((group) => [group.id, group.count])).toEqual([
      ['s06-dune', 1],
      ['s05-copy', 1],
      ['s02-e01', 3],
      ['s03-special', 1],
    ])
    expect(page.items[2]).toMatchObject({
      series: 'Ours',
      showFolder: 'Ours',
      reasons: [
        { reason: 'no_match', count: 2 },
        { reason: 'episode_not_found', count: 1 },
      ],
      first: {
        id: 's02-e01',
        relativePath: 'Ours/Season 1/Ours.S01E01.mkv',
        path: '/media/Ours/Season 1/Ours.S01E01.mkv',
      },
    })
    expect(page.items[3]?.series).toBeUndefined()
    expect(page.items[3]?.showFolder).toBeUndefined()
    expect(page.nextCursor).toBeUndefined()

    const first = await getJson<ReviewGroupsPage>('/sources/review-groups?limit=2')
    expect(first.nextCursor).toBe('s05-copy')
    const next = await getJson<ReviewGroupsPage>(
      `/sources/review-groups?limit=2&cursor=${first.nextCursor}`,
    )
    expect([...first.items, ...next.items].map((group) => group.id)).toEqual(
      page.items.map((group) => group.id),
    )
    expect(next.nextCursor).toBeUndefined()
    const other = await getJson<ReviewGroupsPage>('/sources/review-groups?libraryId=nope')
    expect(other).toEqual({ total: 0, items: [] })
    expect((await world.request('/sources/review-groups?limit=500')).status).toBe(400)
  })

  test('the files of a group are those "an episode of…" takes along', async () => {
    await world.setKey()
    seed()
    const files = await getJson<ReviewGroupFilesResponse>('/sources/s01-e09/review-group')
    const groupIds = files.items.map((file) => file.id)
    expect(groupIds).toEqual(['s02-e01', 's04-e02', 's01-e09'])
    expect((await world.request('/sources/nope/review-group')).status).toBe(404)

    const assigned = await world.request('/sources/s02-e01/assign', {
      method: 'POST',
      json: { kind: 'episode', seriesTmdbId: 136315 },
    })
    expect(assigned.status).toBe(200)
    const body = (await assigned.json()) as AssignResponse
    expect(body.needsReview).toEqual([{ sourceId: 's01-e09', seasonNumber: 1, episodeNumber: 9 }])
    expect(
      [...body.sourceIds, ...body.needsReview.map((entry) => entry.sourceId)].toSorted(),
    ).toEqual(groupIds.toSorted())
    expect(sourceRow('s03-special')).toMatchObject({ match_state: 'needs_review' })
    expect(sourceRow('s05-copy')).toMatchObject({ match_state: 'needs_review' })

    const identified = await world.request('/sources/s02-e01/review-group')
    expect(identified.status).toBe(409)
    expect(await identified.json()).toMatchObject({ error: { code: 'source/not_to_review' } })
  })

  test('hiding a group hides its files to review in one go, nothing else', async () => {
    seed()
    world.db.$client.query("UPDATE sources SET state = 'missing' WHERE id = 's01-e09'").run()
    const hidden = await world.request('/sources/s04-e02/reject-group', { method: 'POST' })
    expect(hidden.status).toBe(200)
    expect((await hidden.json()) as RejectGroupResponse).toEqual({
      sourceIds: ['s02-e01', 's04-e02'],
    })
    for (const id of ['s02-e01', 's04-e02']) {
      expect(sourceRow(id)).toMatchObject({ state: 'rejected', match_state: 'unmatched' })
      expect(linksOf(id)).toEqual([])
    }
    expect(sourceRow('s01-e09')?.state).toBe('missing')
    expect(sourceRow('s03-special')?.state).toBe('ready')
    expect(sourceRow('s05-copy')?.state).toBe('ready')
    const page = await getJson<ReviewGroupsPage>('/sources/review-groups')
    expect(page.total).toBe(3)

    const again = await world.request('/sources/s04-e02/reject-group', { method: 'POST' })
    expect(again.status).toBe(409)
    expect((await world.request('/sources/nope/reject-group', { method: 'POST' })).status).toBe(404)
  })
})
