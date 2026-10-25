import { describe, expect, test } from 'bun:test'

import { ok } from '@projo/shared'

import type { MetadataSettings } from '../../core/metadata/ports.ts'
import { createManualClock } from '../../../test/support/clock.ts'
import { silentLogger } from '../../../test/support/logger.ts'
import { metadataSettingsFactory } from './metadata-settings.ts'

const setup = (initial?: string) => {
  let language = initial
  const settings: MetadataSettings = {
    tmdbApiKey: () => 'key',
    language: () => language ?? 'fr-FR',
    setTmdbApiKey: () => {},
    tmdbApiKeyRejectedAt: () => undefined,
    markTmdbApiKeyRejected: () => {},
    setLanguage: (input) => {
      language = input.language
    },
  }
  let queued = 0
  const admin = metadataSettingsFactory({
    settings,
    tmdb: { validateKey: async () => ok(undefined) },
    items: { sourcesAwaitingMatch: () => [] },
    requestMatch: () => {},
    refresh: {
      queueStaleLanguage: () => {
        queued += 1
        return 0
      },
    },
    notifier: { notify: () => {}, resolve: () => {} },
    clock: createManualClock(),
    logger: silentLogger,
  })
  return { admin, queued: () => queued }
}

describe('server metadata language (§9.4)', () => {
  test('a new language queues the refresh of what was written in another one', async () => {
    const world = setup()
    expect((await world.admin.update({ language: 'en-US' })).ok).toBe(true)
    expect(world.admin.get().language).toBe('en-US')
    expect(world.queued()).toBe(1)
  })

  test('the same language (default included), or no language, queues nothing', async () => {
    const world = setup()
    await world.admin.update({ language: 'fr-FR' })
    await world.admin.update({})
    expect(world.queued()).toBe(0)
  })
})
