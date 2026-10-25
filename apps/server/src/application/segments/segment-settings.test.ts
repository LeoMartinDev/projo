import { describe, expect, test } from 'bun:test'

import type { SegmentSettings } from '../../core/settings/settings.ts'
import { createManualClock } from '../../../test/support/clock.ts'
import { silentLogger } from '../../../test/support/logger.ts'
import { fakeSegmentProviders, inMemorySegmentSettings } from '../../../test/support/segments.ts'
import { segmentSettingsAdminFactory } from './segment-settings.ts'

const build = (initial: Partial<SegmentSettings> = {}) => {
  const fake = fakeSegmentProviders()
  const store = inMemorySegmentSettings(initial)
  const admin = segmentSettingsAdminFactory({
    store,
    validateTheintrodbKey: fake.providers.validateTheintrodbKey,
    clock: createManualClock(),
    logger: silentLogger,
  })
  return { admin, store, validated: fake.validatedKeys }
}

describe('§15 "Génériques" settings', () => {
  test('defaults; the key is never shown, only configured and its last 4', async () => {
    const { admin, store, validated } = build({ skipdbAnonymousKey: 'anon' })
    expect(admin.get()).toEqual({
      providers: ['theintrodb', 'introdb', 'skipdb'],
      theintrodbApiKey: { configured: false },
      fingerprint: {
        enabled: true,
        introMinutes: 10,
        creditsMinutes: 5,
        minSeconds: 15,
        maxSeconds: 150,
        similarity: 0.8,
      },
      contribution: 'off',
    })
    const result = await admin.update({ theintrodbApiKey: 'good-key-1234' })
    expect(result).toMatchObject({
      ok: true,
      value: { theintrodbApiKey: { configured: true, last4: '1234' } },
    })
    expect(JSON.stringify(result)).not.toContain('good-key')
    expect(JSON.stringify(result)).not.toContain('anon')
    expect(validated).toEqual(['good-key-1234'])
    expect(store.read().theintrodbApiKey).toBe('good-key-1234')
  })

  test('a refused key is not stored', async () => {
    const { admin, store } = build()
    expect(await admin.update({ theintrodbApiKey: 'bad-key-0000' })).toMatchObject({
      ok: false,
      error: { code: 'segment/theintrodb_key_invalid' },
    })
    expect(store.read().theintrodbApiKey).toBeUndefined()
  })

  test('manual_only needs a key, set before or in the same update', async () => {
    const { admin } = build()
    expect(await admin.update({ contribution: 'manual_only' })).toMatchObject({
      ok: false,
      error: { code: 'segment/contribution_requires_key' },
    })
    expect(
      await admin.update({ contribution: 'manual_only', theintrodbApiKey: 'good-key-5678' }),
    ).toMatchObject({ ok: true, value: { contribution: 'manual_only' } })
    // Removing the key while contributing: refused.
    expect(await admin.update({ theintrodbApiKey: '' })).toMatchObject({
      ok: false,
      error: { code: 'segment/contribution_requires_key' },
    })
    expect(await admin.update({ theintrodbApiKey: '', contribution: 'off' })).toMatchObject({
      ok: true,
      value: { theintrodbApiKey: { configured: false }, contribution: 'off' },
    })
  })

  test('providers and fingerprint thresholds, partially', async () => {
    const { admin } = build()
    const result = await admin.update({
      providers: ['skipdb'],
      fingerprint: { enabled: false, introMinutes: 8 },
    })
    expect(result).toMatchObject({
      ok: true,
      value: {
        providers: ['skipdb'],
        fingerprint: { enabled: false, introMinutes: 8, creditsMinutes: 5 },
      },
    })
  })
})
