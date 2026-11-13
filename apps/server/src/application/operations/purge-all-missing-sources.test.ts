import { describe, expect, test } from 'bun:test'

import { createMissingSourcesWorld as build } from '../../../test/support/operations-fakes.ts'
import { purgeAllMissingSourcesFactory } from './purge-all-missing-sources.ts'

describe('missing sources (§7.5, §15 "Manquants")', () => {
  test('the metadata domain sees the files before they go, then once they are gone (§9.1)', () => {
    const { deps, leaving, settled } = build({ a: { state: 'missing' }, b: { state: 'missing' } })
    purgeAllMissingSourcesFactory(deps)({})
    expect(leaving).toEqual([{ sourceIds: ['a', 'b'] }])
    expect(settled).toEqual(leaving)
    const empty = build({ c: { state: 'ready' } })
    purgeAllMissingSourcesFactory(empty.deps)({})
    expect(empty.leaving).toEqual([])
  })

  test('purges all; nothing to do touches nothing', () => {
    const { deps, purgedBatches, ended } = build({
      a: { state: 'missing' },
      b: { state: 'missing' },
      c: { state: 'ready' },
    })
    expect(purgeAllMissingSourcesFactory(deps)({})).toEqual({ purged: 2 })
    expect(purgedBatches).toEqual([['a', 'b']])
    const empty = build({ c: { state: 'ready' } })
    expect(purgeAllMissingSourcesFactory(empty.deps)({})).toEqual({ purged: 0 })
    expect(empty.ended).toEqual([])
    expect(ended).toHaveLength(1)
  })
})
