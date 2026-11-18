import { describe, expect, test } from 'bun:test'

import { inMemoryTvChannels } from '../../../test/support/tv-world.ts'
import { listTvChannelsFactory } from './list-tv-channels.ts'

const createdAt = new Date('2026-06-01T00:00:00.000Z')

describe('listTvChannels (§29.7)', () => {
  test('every enabled, present channel in group then playlist order, with its groups', () => {
    const { repository, groups, channels } = inMemoryTvChannels()
    groups.set('news', { id: 'news', sourceId: 's', name: 'News', enabled: true, position: 1 })
    groups.set('kids', { id: 'kids', sourceId: 's', name: 'Kids', enabled: false, position: 0 })
    groups.set('empty', { id: 'empty', sourceId: 's', name: '', enabled: true, position: 2 })
    const channel = (id: string, groupId: string, position: number, more = {}) =>
      channels.set(id, {
        id,
        sourceId: 's',
        key: id,
        name: id,
        groupId,
        position,
        upstream: { url: `http://provider.test/${id}` },
        enabled: true,
        createdAt,
        ...more,
      })
    channel('n2', 'news', 3)
    channel('n1', 'news', 2)
    channel('k1', 'kids', 1)
    channel('off', 'empty', 4, { enabled: false })
    channel('gone', 'empty', 5, { missingSince: createdAt })

    const listed = listTvChannelsFactory({ tvChannels: repository })()
    expect(listed.groups.map((group) => group.id)).toEqual(['kids', 'news'])
    expect(listed.channels.map((c) => c.id)).toEqual(['k1', 'n1', 'n2'])
  })
})
