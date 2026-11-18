import { describe, expect, test } from 'bun:test'

import type { TvChannelsResponse } from '@projo/shared/api/tv'

import { channelOrder, channelSections } from './queries.ts'

const response: TvChannelsResponse = {
  groups: [
    { id: 'g-news', name: 'News' },
    { id: 'g-other', name: '' },
    { id: 'g-empty', name: 'Empty' },
  ],
  items: [
    { id: 'c1', name: 'News One', number: 1, groupId: 'g-news' },
    { id: 'c3', name: 'Local', groupId: 'g-other' },
    { id: 'c2', name: 'News Two', groupId: 'g-news' },
  ],
}

describe('TV page (§29.6)', () => {
  test('one section per group in order, a group without channel left out', () => {
    expect(
      channelSections(response).map(({ group, channels }) => [
        group.id,
        channels.map((channel) => channel.id),
      ]),
    ).toEqual([
      ['g-news', ['c1', 'c2']],
      ['g-other', ['c3']],
    ])
  })

  test('zapping follows the sections', () => {
    expect(channelOrder(response)).toEqual(['c1', 'c2', 'c3'])
  })
})
