import { describe, expect, test } from 'bun:test'

import { ok } from '@projo/shared'

import type { Library, LibraryRepository } from '../../core/library/library.ts'
import { createSequentialIds } from '../../../test/support/fakes.ts'
import { silentLogger } from '../../../test/support/logger.ts'
import { updateLibraryFactory } from './update-library.ts'

const films: Library = {
  id: 'lib',
  name: 'Films',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  roots: [],
  hint: 'auto',
  scanIntervalMinutes: 15,
  watchEnabled: true,
  quietPeriodSeconds: 120,
  detectSegments: true,
  preExtractSubtitles: false,
  trickplayEnabled: true,
  ratingCountry: 'FR',
}

const setup = (initial: Library = films) => {
  let library = initial
  const libraryRepository: LibraryRepository = {
    list: () => [library],
    findById: (id) => (id === library.id ? library : undefined),
    findByName: () => undefined,
    listRoots: () => [],
    create: () => library,
    update: ({ changes }) => {
      const { metadataLanguage, ...rest } = changes
      const next: Library = { ...library, ...rest }
      if ('metadataLanguage' in changes) {
        delete next.metadataLanguage
        if (metadataLanguage !== undefined) next.metadataLanguage = metadataLanguage
      }
      library = next
      return library
    },
    delete: () => {},
    markRootScanned: () => {},
    markRootUnreachable: () => {},
  }
  const changed: { libraryId: string; language: boolean; ratingCountry: boolean }[] = []
  const update = updateLibraryFactory({
    libraryRepository,
    localItems: { itemIdsOfLibrary: () => [], pruneOrphans: () => {} },
    playbackSessions: { endWithin: () => {} },
    validateRoots: async ({ paths }) => ok([...paths]),
    requestScan: () => ({ jobId: 'job', deduplicated: false }),
    metadataContext: {
      changed: (input) => void changed.push(input),
      filesLeaving: () => () => {},
    },
    ids: createSequentialIds(),
    logger: silentLogger,
  })
  return { update, changed }
}

describe('metadata language and rating country of a library (§9.4)', () => {
  test('a new language or rating country is told to the metadata domain', async () => {
    const world = setup()
    await world.update({ id: 'lib', changes: { metadataLanguage: 'en-US' } })
    await world.update({ id: 'lib', changes: { ratingCountry: 'US' } })
    // Back to the server setting.
    await world.update({ id: 'lib', changes: { metadataLanguage: undefined, ratingCountry: 'DE' } })
    expect(world.changed).toEqual([
      { libraryId: 'lib', language: true, ratingCountry: false },
      { libraryId: 'lib', language: false, ratingCountry: true },
      { libraryId: 'lib', language: true, ratingCountry: true },
    ])
  })

  test('unchanged values, or other settings, tell nothing', async () => {
    const world = setup({ ...films, metadataLanguage: 'fr-FR' })
    await world.update({
      id: 'lib',
      changes: { metadataLanguage: 'fr-FR', ratingCountry: 'FR', name: 'Cinéma' },
    })
    await world.update({ id: 'lib', changes: { scanIntervalMinutes: 30 } })
    expect(world.changed).toEqual([])
  })
})
