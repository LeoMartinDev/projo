import { describe, expect, test } from 'bun:test'

import { createMissingSourcesWorld as build } from '../../../test/support/operations-fakes.ts'
import { purgeMissingSourceFactory } from './purge-missing-source.ts'

describe('missing sources (§7.5, §15 "Manquants")', () => {
  test('purges one missing source after ending its sessions', () => {
    const { deps, purgedBatches, ended } = build({ a: { state: 'missing' } })
    expect(purgeMissingSourceFactory(deps)({ sourceId: 'a' })).toEqual({
      ok: true,
      value: undefined,
    })
    expect(ended).toEqual([{ sourceIds: ['a'] }])
    expect(purgedBatches).toEqual([['a']])
  })

  test('refuses a source that is not missing, and an unknown one', () => {
    const { deps, purgedBatches } = build({ a: { state: 'ready' } })
    const purge = purgeMissingSourceFactory(deps)
    expect(purge({ sourceId: 'a' })).toMatchObject({
      ok: false,
      error: { code: 'source/not_missing' },
    })
    expect(purge({ sourceId: 'b' })).toMatchObject({
      ok: false,
      error: { code: 'source/not_found' },
    })
    expect(purgedBatches).toEqual([])
  })
})
