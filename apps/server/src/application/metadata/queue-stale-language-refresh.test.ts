import { describe, expect, test } from 'bun:test'

import {
  lowPriorityRefresh as low,
  createMetadataRefreshWorld as setup,
} from '../../../test/support/metadata-refresh-world.ts'

describe('refresh queued on a change of language or rating country (§9.4)', () => {
  test('server language: every stale movie or series, low priority, deduplicated by item', () => {
    const world = setup({ serverLanguage: 'en-US', stale: { '': ['movie', 'series'] } })
    expect(world.queueStaleLanguageRefresh()).toBe(2)
    expect(world.staleCalls).toEqual([{ serverLanguage: 'en-US' }])
    expect(world.refreshes()).toEqual([low('movie'), low('series')])
  })
})
