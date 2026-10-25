import { describe, expect, test } from 'bun:test'

import { jobTargetOf } from './target.ts'

describe('jobTargetOf (§15 "cible")', () => {
  test('reads the subject of each kind of payload', () => {
    expect(jobTargetOf('scan_library', { libraryId: 'lib', kind: 'manual_quick' })).toEqual({
      kind: 'library',
      id: 'lib',
    })
    expect(jobTargetOf('probe_source', { sourceId: 'src', mode: 'recheck' })).toEqual({
      kind: 'source',
      id: 'src',
    })
    expect(jobTargetOf('fetch_images', { itemId: 'item' })).toEqual({ kind: 'item', id: 'item' })
    expect(jobTargetOf('fingerprint_season', { seasonId: 's1' })).toEqual({
      kind: 'season',
      id: 's1',
    })
    expect(jobTargetOf('apply_update', { version: '1.2.0' })).toEqual({
      kind: 'version',
      id: '1.2.0',
    })
  })

  test('refresh_metadata targets an item or a whole library', () => {
    expect(jobTargetOf('refresh_metadata', { itemId: 'item' })).toEqual({
      kind: 'item',
      id: 'item',
    })
    expect(jobTargetOf('refresh_metadata', { libraryId: 'lib' })).toEqual({
      kind: 'library',
      id: 'lib',
    })
  })

  test('no target for subjectless jobs or unexpected payloads', () => {
    expect(jobTargetOf('watch_pending', {})).toBeUndefined()
    expect(jobTargetOf('cleanup_cache', {})).toBeUndefined()
    expect(jobTargetOf('purge_missing', {})).toBeUndefined()
    expect(jobTargetOf('probe_source', 'not an object')).toBeUndefined()
    expect(jobTargetOf('probe_source', { sourceId: 42 })).toBeUndefined()
    expect(jobTargetOf('probe_source', { sourceId: '' })).toBeUndefined()
  })
})
