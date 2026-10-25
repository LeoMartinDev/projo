import { beforeEach, describe, expect, test } from 'bun:test'

import { insertItem, seedViewer } from '../../../test/support/catalog-fixtures.ts'
import { createTestDatabase } from '../../../test/support/database.ts'
import type { TrackPreferenceRepository } from '../../core/playback/track-preferences.ts'
import { createSqliteTrackPreferenceRepository } from './track-preference-repository.ts'

let repository: TrackPreferenceRepository
let profileId: string

beforeEach(() => {
  const db = createTestDatabase()
  profileId = seedViewer(db).profileId
  insertItem(db, { id: 'show', kind: 'series' })
  repository = createSqliteTrackPreferenceRepository({ db })
})

describe('track_preferences', () => {
  test('saves, replaces, reads back and deletes', () => {
    const key = { profileId, itemId: 'show' }
    expect(repository.find(key)).toBeUndefined()
    repository.save({
      ...key,
      audioLanguage: 'ja',
      subtitleLanguage: 'fr',
      subtitlesEnabled: true,
      updatedAt: new Date('2026-10-23T10:00:00.000Z'),
    })
    repository.save({
      ...key,
      audioLanguage: 'fr',
      subtitlesEnabled: false,
      updatedAt: new Date('2026-10-23T11:00:00.000Z'),
    })
    expect(repository.find(key)).toEqual({
      ...key,
      audioLanguage: 'fr',
      subtitlesEnabled: false,
      updatedAt: new Date('2026-10-23T11:00:00.000Z'),
    })
    expect(repository.delete(key)).toBe(true)
    expect(repository.delete(key)).toBe(false)
    expect(repository.find(key)).toBeUndefined()
  })
})
