import { describe, expect, test } from 'bun:test'

import {
  createSetupWorld as build,
  setupInput as input,
} from '../../../test/support/setup-world.ts'

describe('completeSetup', () => {
  test('creates the admin, its first profile and the settings', async () => {
    const t = build()
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
