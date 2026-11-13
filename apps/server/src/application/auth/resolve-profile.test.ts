import { describe, expect, test } from 'bun:test'

import { sampleProfile } from '../../../test/support/auth.ts'
import { createAuthWorld as setup } from '../../../test/support/auth-world.ts'

describe('resolveProfile', () => {
  const second = sampleProfile({ id: 'profile-2', name: 'Zoé' })
  const foreign = sampleProfile({ id: 'profile-x', accountId: 'account-2' })

  test('without header: the only profile of the account', () => {
    const t = setup()
    const { session } = t.openSession({
      accountId: 'account-1',
      kind: 'cookie',
      deviceName: 'd',
      userAgent: '',
    })
    expect(t.resolveProfile({ session, requestedProfileId: undefined })).toEqual({
      ok: true,
      value: 'profile-1',
    })
  })

  test('without header and several profiles: the last one of the session, else none', () => {
    const t = setup({ profiles: [sampleProfile(), second] })
    const { session } = t.openSession({
      accountId: 'account-1',
      kind: 'cookie',
      deviceName: 'd',
      userAgent: '',
    })
    expect(t.resolveProfile({ session, requestedProfileId: undefined })).toEqual({
      ok: true,
      value: undefined,
    })
    expect(
      t.resolveProfile({
        session: { ...session, lastProfileId: 'profile-2' },
        requestedProfileId: undefined,
      }),
    ).toEqual({ ok: true, value: 'profile-2' })
  })

  test('X-Profile-Id must belong to the account and is remembered', () => {
    const t = setup({ profiles: [sampleProfile(), second, foreign] })
    const { session } = t.openSession({
      accountId: 'account-1',
      kind: 'cookie',
      deviceName: 'd',
      userAgent: '',
    })
    expect(t.resolveProfile({ session, requestedProfileId: 'profile-2' })).toEqual({
      ok: true,
      value: 'profile-2',
    })
    expect(t.sessions.get(session.id)?.lastProfileId).toBe('profile-2')
    expect(t.resolveProfile({ session, requestedProfileId: 'profile-x' })).toMatchObject({
      ok: false,
      error: { code: 'profile/forbidden' },
    })
    expect(t.resolveProfile({ session, requestedProfileId: 'missing' })).toMatchObject({
      ok: false,
      error: { code: 'profile/forbidden' },
    })
  })
})

describe('resolveProfile with a PIN (§13.6)', () => {
  const locked = sampleProfile({ id: 'profile-2', name: 'Parent', pinHash: 'hashed:1234' })

  test('a PIN-locked profile in X-Profile-Id needs to be unlocked by this session first', () => {
    const t = setup({ profiles: [sampleProfile(), locked] })
    const { session } = t.openSession({
      accountId: 'account-1',
      kind: 'cookie',
      deviceName: 'd',
      userAgent: '',
      lastProfileId: 'profile-1',
    })
    expect(t.resolveProfile({ session, requestedProfileId: 'profile-2' })).toMatchObject({
      ok: false,
      error: { code: 'profile/pin_required' },
    })
    expect(t.sessions.get(session.id)?.lastProfileId).toBe('profile-1')
    expect(
      t.resolveProfile({
        session: { ...session, lastProfileId: 'profile-2' },
        requestedProfileId: 'profile-2',
      }),
    ).toEqual({ ok: true, value: 'profile-2' })
  })

  test('the only profile of an account is never locked', () => {
    const t = setup({ profiles: [sampleProfile({ pinHash: 'hashed:1234' })] })
    const { session } = t.openSession({
      accountId: 'account-1',
      kind: 'cookie',
      deviceName: 'd',
      userAgent: '',
    })
    expect(t.resolveProfile({ session, requestedProfileId: 'profile-1' })).toEqual({
      ok: true,
      value: 'profile-1',
    })
  })
})
