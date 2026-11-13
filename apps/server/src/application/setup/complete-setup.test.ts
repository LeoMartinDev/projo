import { describe, expect, test } from 'bun:test'

import { createFakePasswordHasher, createInMemorySetup } from '../../../test/support/auth.ts'
import { createManualClock } from '../../../test/support/clock.ts'
import { createSequentialIds } from '../../../test/support/fakes.ts'
import { silentLogger } from '../../../test/support/logger.ts'
import type { SettingsRepository } from '../../core/settings/settings.ts'
import { completeSetupFactory } from './complete-setup.ts'
import { getSetupStatusFactory } from './get-setup-status.ts'

const input = {
  username: 'leo',
  password: 'correct horse battery',
  serverName: 'Maison',
  metadataLanguage: 'fr-FR',
  uiLocale: 'fr' as const,
}

const build = () => {
  const setup = createInMemorySetup()
  const settingsRepository: SettingsRepository = { get: (key) => setup.state.settings.get(key) }
  return {
    setup,
    completeSetup: completeSetupFactory({
      setupRepository: setup.repository,
      passwordHasher: createFakePasswordHasher().hasher,
      clock: createManualClock(),
      ids: createSequentialIds(),
      logger: silentLogger,
    }),
    getStatus: getSetupStatusFactory({ setupRepository: setup.repository, settingsRepository }),
  }
}

describe('completeSetup', () => {
  test('creates the admin, its first profile and the settings', async () => {
    const t = build()
    expect(t.getStatus()).toEqual({ completed: false })

    const result = await t.completeSetup(input)
    expect(result).toMatchObject({
      ok: true,
      value: {
        account: { username: 'leo', role: 'admin', passwordHash: 'hashed:correct horse battery' },
        profile: {
          name: 'leo',
          avatarColor: 'blue',
          uiLocale: 'fr',
          audioLanguage: 'fr',
          subtitleLanguage: 'fr',
          subtitleMode: 'when_audio_differs',
          animeOriginalAudio: true,
        },
      },
    })
    if (result.ok) expect(result.value.profile.accountId).toBe(result.value.account.id)
    expect(t.setup.state.settings.get('metadata.language')).toBe('fr-FR')
    expect(t.getStatus()).toEqual({ completed: true, serverName: 'Maison' })
  })

  test('takes the profile name and colour when given', async () => {
    const t = build()
    const result = await t.completeSetup({ ...input, profileName: 'Papa', avatarColor: 'sage' })
    expect(result).toMatchObject({
      ok: true,
      value: { profile: { name: 'Papa', avatarColor: 'sage' } },
    })
  })

  test('refused once an account exists, including a concurrent second call', async () => {
    const t = build()
    const [first, second] = await Promise.all([
      t.completeSetup(input),
      t.completeSetup({ ...input, username: 'mallory' }),
    ])
    expect(first.ok).toBe(true)
    expect(second).toMatchObject({ ok: false, error: { code: 'setup/already_completed' } })
    expect(await t.completeSetup(input)).toMatchObject({
      ok: false,
      error: { code: 'setup/already_completed' },
    })
    expect(t.setup.state.accounts).toHaveLength(1)
  })
})
