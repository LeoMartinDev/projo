import { describe, expect, test } from 'bun:test'

import { createJobsAdminWorld as build, job } from '../../../test/support/operations-world.ts'

describe('jobs admin (§15 "Jobs")', () => {
  test('lists jobs with their named target, or the bare target when it is gone', () => {
    const { listJobs } = build([
      job({ id: 'a', payload: { sourceId: 'source-1' } }),
      job({ id: 'b', type: 'scan_library', payload: { libraryId: 'gone', kind: 'periodic' } }),
      job({ id: 'c', type: 'cleanup_cache', payload: {} }),
      job({ id: 'd', type: 'fetch_images', payload: { itemId: 'episode-1' } }),
    ])
    const page = listJobs({ limit: 10 })
    expect(page.items.map((entry) => entry.target)).toEqual([
      { kind: 'source', id: 'source-1', label: 'name of source-1' },
      { kind: 'library', id: 'gone' },
      undefined,
      {
        kind: 'item',
        id: 'episode-1',
        item: { kind: 'episode', seriesTitle: 'Severance', seasonNumber: 2, episodeNumber: 4 },
      },
    ])
  })
})
