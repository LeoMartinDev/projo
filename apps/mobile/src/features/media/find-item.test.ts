import { describe, expect, test } from 'bun:test'

import type { ItemSummaryDto } from '@projo/shared/api/catalog'

import { findItem } from './find-item.ts'

const item = (id: string, extra: Partial<ItemSummaryDto> = {}): ItemSummaryDto => ({
  id,
  kind: 'movie',
  sortTitle: id,
  images: {},
  genres: [],
  ...extra,
})

describe('the card sheet reads its item in the cached data', () => {
  test('in home rows, up next entries and infinite pages', () => {
    const episode = item('e1', { kind: 'episode', series: { id: 's1', kind: 'series' } })
    const home = {
      hero: { item: item('m1') },
      rows: [
        { kind: 'continue_watching', items: [episode] },
        { kind: 'up_next', items: [{ episode: item('e2', { kind: 'episode' }), isNew: true }] },
        { kind: 'recently_added', items: [item('s1', { kind: 'series', inWatchlist: true })] },
      ],
    }
    expect(findItem(home, 'e2')?.kind).toBe('episode')
    // The series of an episode is a reference, not the series' card.
    expect(findItem(home, 's1')?.inWatchlist).toBe(true)
    expect(findItem({ pages: [{ items: [item('a')] }, { items: [item('b')] }] }, 'b')?.id).toBe('b')
  })

  test('nothing when the item left the data', () => {
    expect(findItem({ rows: [] }, 'm1')).toBeUndefined()
    expect(findItem(undefined, 'm1')).toBeUndefined()
  })
})
