import { describe, expect, test } from 'bun:test'

import {
  adminPassword,
  createAuthTestApp,
  sessionCookieOf,
} from '../../../../test/support/auth-app.ts'
import { insertLibrary } from '../../../../test/support/catalog-fixtures.ts'

type ErrorBody = { error: { code: string } }
const errorCode = async (response: Response) => ((await response.json()) as ErrorBody).error.code

type AccountBody = {
  id: string
  username: string
  role: string
  disabledAt?: string
  lastSeenAt?: string
  lastDeviceName?: string
  activeSessions: number
  playing: boolean
  profiles: { id: string; name: string; playing: boolean; libraryIds: string[] }[]
}

const zoePassword = 'another long password'

const household = async () => {
  const t = createAuthTestApp()
  const { cookie } = await t.completeSetup()
  const admin = t.as(cookie)
  const { account } = await t.addUser()
  const zoeLogin = await t.login('zoe', zoePassword, {
    'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari/604.1',
  })
  const zoe = t.as(sessionCookieOf(zoeLogin))
  const leoId = ((await (await admin.get('/api/v1/auth/me')).json()) as { account: { id: string } })
    .account.id
  return { t, admin, zoe, zoeId: account.id, leoId }
}

describe('admin accounts (§15 Comptes)', () => {
  test('lists accounts with profiles, activity and device; admins only', async () => {
    const { admin, zoe, zoeId } = await household()
    const response = await admin.get('/api/v1/admin/accounts')
    expect(response.status).toBe(200)
    const { items } = (await response.json()) as { items: AccountBody[] }
    // Oldest first: `addUser` backdates zoe to 2026-01-01.
    expect(items.map((item) => [item.username, item.role])).toEqual([
      ['zoe', 'user'],
      ['leo', 'admin'],
    ])
    expect(items.find((item) => item.id === zoeId)).toMatchObject({
      lastDeviceName: 'Safari · iOS',
      lastSeenAt: expect.any(String),
      activeSessions: 1,
      playing: false,
      profiles: [{ name: 'zoe', playing: false, libraryIds: [] }],
    })

    const forbidden = await zoe.get('/api/v1/admin/accounts')
    expect(forbidden.status).toBe(403)
    expect(await errorCode(forbidden)).toBe('auth/forbidden')
  })

  test('create an account directly', async () => {
    const { t, admin } = await household()
    const created = await admin.send('POST', '/api/v1/admin/accounts', {
      username: 'sam',
      password: 'sam has a long password',
      profile: { name: 'Sam', avatarColor: 'honey' },
    })
    expect(created.status).toBe(201)
    expect(await created.json()).toMatchObject({
      username: 'sam',
      role: 'user',
      activeSessions: 0,
      profiles: [{ name: 'Sam', avatarColor: 'honey' }],
    })
    expect((await t.login('sam', 'sam has a long password')).status).toBe(200)
    const taken = await admin.send('POST', '/api/v1/admin/accounts', {
      username: 'ZOE',
      password: 'sam has a long password',
    })
    expect(taken.status).toBe(409)
    expect(await errorCode(taken)).toBe('auth/username_taken')
  })

  test('the last admin cannot demote, disable or delete itself', async () => {
    const { admin, leoId, zoeId } = await household()
    for (const body of [{ role: 'user' }, { disabled: true }]) {
      const response = await admin.send('PATCH', `/api/v1/admin/accounts/${leoId}`, body)
      expect(response.status).toBe(409)
      expect(await errorCode(response)).toBe('account/last_admin')
    }
    const deleted = await admin.send('DELETE', `/api/v1/admin/accounts/${leoId}`, {
      confirmUsername: 'leo',
    })
    expect(deleted.status).toBe(409)

    // Once zoe is admin too, leo may step down.
    const promoted = await admin.send('PATCH', `/api/v1/admin/accounts/${zoeId}`, { role: 'admin' })
    expect(await promoted.json()).toMatchObject({ role: 'admin' })
    expect(
      (await admin.send('PATCH', `/api/v1/admin/accounts/${leoId}`, { role: 'user' })).status,
    ).toBe(200)
    // Now a user: the admin pages are closed to leo.
    expect((await admin.get('/api/v1/admin/accounts')).status).toBe(403)
  })

  test('disabling revokes the sessions and blocks sign-in; data is kept', async () => {
    const { t, admin, zoe, zoeId } = await household()
    const disabled = await admin.send('PATCH', `/api/v1/admin/accounts/${zoeId}`, {
      disabled: true,
    })
    expect(disabled.status).toBe(200)
    expect(await disabled.json()).toMatchObject({
      disabledAt: expect.any(String),
      activeSessions: 0,
    })
    expect((await zoe.get('/api/v1/auth/me')).status).toBe(401)
    const login = await t.login('zoe', zoePassword)
    expect(login.status).toBe(403)
    expect(await errorCode(login)).toBe('auth/account_disabled')

    await admin.send('PATCH', `/api/v1/admin/accounts/${zoeId}`, { disabled: false })
    expect((await t.login('zoe', zoePassword)).status).toBe(200)
  })

  test('reset password and revoke sessions', async () => {
    const { t, admin, zoe, zoeId } = await household()
    const reset = await admin.send('POST', `/api/v1/admin/accounts/${zoeId}/reset-password`, {
      password: 'a brand new password',
    })
    expect(reset.status).toBe(204)
    expect((await zoe.get('/api/v1/auth/me')).status).toBe(401)
    expect((await t.login('zoe', zoePassword)).status).toBe(401)
    const fresh = t.as(sessionCookieOf(await t.login('zoe', 'a brand new password')))
    expect((await fresh.get('/api/v1/auth/me')).status).toBe(200)

    expect(
      (await admin.send('POST', `/api/v1/admin/accounts/${zoeId}/revoke-sessions`)).status,
    ).toBe(204)
    expect((await fresh.get('/api/v1/auth/me')).status).toBe(401)
    expect((await admin.send('POST', '/api/v1/admin/accounts/nope/revoke-sessions')).status).toBe(
      404,
    )
  })

  test('deletion needs the username typed, then removes the account and its profiles', async () => {
    const { t, admin, zoe, zoeId } = await household()
    const missing = await admin.send('DELETE', `/api/v1/admin/accounts/${zoeId}`)
    expect(missing.status).toBe(400)
    const mismatch = await admin.send('DELETE', `/api/v1/admin/accounts/${zoeId}`, {
      confirmUsername: 'zo',
    })
    expect(mismatch.status).toBe(400)
    expect(await errorCode(mismatch)).toBe('account/confirmation_mismatch')

    const deleted = await admin.send('DELETE', `/api/v1/admin/accounts/${zoeId}`, {
      confirmUsername: 'zoe',
    })
    expect(deleted.status).toBe(204)
    const { items } = (await (await admin.get('/api/v1/admin/accounts')).json()) as {
      items: AccountBody[]
    }
    expect(items.map((item) => item.username)).toEqual(['leo'])
    expect((await zoe.get('/api/v1/auth/me')).status).toBe(401)
    expect((await t.login('zoe', zoePassword)).status).toBe(401)
  })
})

describe('invitations outlive the admin who created them', () => {
  test('deleting that admin keeps the history, without creator', async () => {
    const { t, admin, zoeId } = await household()
    expect(
      (await admin.send('PATCH', `/api/v1/admin/accounts/${zoeId}`, { role: 'admin' })).status,
    ).toBe(200)
    const zoeSession = t.as(sessionCookieOf(await t.login('zoe', zoePassword)))
    const created = await zoeSession.send('POST', '/api/v1/admin/invitations')
    expect(created.status).toBe(201)
    const { invitation } = (await created.json()) as { invitation: { id: string } }

    const deleted = await admin.send('DELETE', `/api/v1/admin/accounts/${zoeId}`, {
      confirmUsername: 'zoe',
    })
    expect(deleted.status).toBe(204)
    const list = (await (await admin.get('/api/v1/admin/invitations')).json()) as {
      items: { id: string; createdBy?: unknown }[]
    }
    expect(list.items.map((item) => item.id)).toEqual([invitation.id])
    expect(list.items[0]?.createdBy).toBeUndefined()
  })
})

describe('profiles administered from an account or a library (§14, §15)', () => {
  test('an admin adds a profile to another account; the end of a playback is asked first on deletions', async () => {
    const { t, admin, zoe, zoeId } = await household()
    const created = await admin.send('POST', `/api/v1/admin/accounts/${zoeId}/profiles`, {
      name: 'Petit',
      maxContentRating: '10',
    })
    expect(created.status).toBe(201)
    const petit = (await created.json()) as { id: string; name: string; maxContentRating: string }
    expect(petit).toMatchObject({ name: 'Petit', maxContentRating: '10' })
    const { items } = (await (await admin.get('/api/v1/admin/accounts')).json()) as {
      items: AccountBody[]
    }
    expect(items.find((item) => item.id === zoeId)?.profiles.map((p) => p.name)).toEqual([
      'zoe',
      'Petit',
    ])
    expect(
      (await admin.send('POST', '/api/v1/admin/accounts/nope/profiles', { name: 'X' })).status,
    ).toBe(404)
    expect(
      (await zoe.send('POST', `/api/v1/admin/accounts/${zoeId}/profiles`, { name: 'X' })).status,
    ).toBe(403)

    // Deleting a profile, then the account: their playback sessions end first (§10.6).
    expect((await admin.send('DELETE', `/api/v1/profiles/${petit.id}`)).status).toBe(204)
    expect(t.endedPlayback).toEqual([{ profileIds: [petit.id] }])
    await admin.send('DELETE', `/api/v1/admin/accounts/${zoeId}`, { confirmUsername: 'zoe' })
    expect(t.endedPlayback).toContainEqual({ accountId: zoeId })
  })

  test('the administration is closed to a restricted profile of an admin account', async () => {
    const { t, admin } = await household()
    const kid = (await (
      await admin.send('POST', '/api/v1/profiles', { name: 'Enfant', maxContentRating: '10' })
    ).json()) as { id: string }
    const forbidden = await admin.get('/api/v1/admin/accounts', { 'x-profile-id': kid.id })
    expect(forbidden.status).toBe(403)
    expect(await errorCode(forbidden)).toBe('auth/restricted_profile')
    const me = (await (await admin.get('/api/v1/auth/me')).json()) as {
      profiles: { id: string; name: string }[]
    }
    const own = me.profiles.find((profile) => profile.name !== 'Enfant')
    expect(
      (await admin.get('/api/v1/admin/accounts', { 'x-profile-id': own?.id ?? '' })).status,
    ).toBe(200)
    // A new device that has not chosen a profile yet: no active profile, no administration.
    const fresh = t.as(sessionCookieOf(await t.login('leo', adminPassword)))
    const unresolved = await fresh.get('/api/v1/admin/accounts')
    expect(unresolved.status).toBe(403)
    expect(await errorCode(unresolved)).toBe('auth/restricted_profile')
  })

  test('"Profils ayant accès": read and set from the library, same rows as the profile', async () => {
    const { t, admin, zoeId } = await household()
    insertLibrary(t.db, { id: 'films', rootPath: '/films' })
    insertLibrary(t.db, { id: 'series', rootPath: '/series' })
    type Access = { items: { profileId: string; username: string; hasAccess: boolean }[] }
    const read = async () =>
      ((await (await admin.get('/api/v1/admin/libraries/films/profiles')).json()) as Access).items
    expect((await read()).map((row) => [row.username, row.hasAccess])).toEqual([
      ['zoe', true],
      ['leo', true],
    ])
    const leoProfile = (await read()).find((row) => row.username === 'leo')?.profileId ?? ''
    const zoeProfile = `profile-zoe`

    // zoe loses "films": from "all" to every other library.
    const set = await admin.send('PUT', '/api/v1/admin/libraries/films/profiles', {
      profileIds: [leoProfile],
    })
    expect(set.status).toBe(200)
    expect(((await set.json()) as Access).items.map((row) => row.hasAccess)).toEqual([false, true])
    const zoeOf = async () => {
      const { items } = (await (await admin.get('/api/v1/admin/accounts')).json()) as {
        items: (AccountBody & { profiles: { libraryAccess: string; libraryIds: string[] }[] })[]
      }
      return items.find((item) => item.id === zoeId)?.profiles[0]
    }
    expect(await zoeOf()).toMatchObject({ libraryAccess: 'selected', libraryIds: ['series'] })

    // Given back: her selection plus "films".
    await admin.send('PUT', '/api/v1/admin/libraries/films/profiles', {
      profileIds: [leoProfile, zoeProfile],
    })
    expect((await zoeOf())?.libraryIds.sort()).toEqual(['films', 'series'])

    // The admin cannot untick their own last unrestricted profile (§14).
    const lockout = await admin.send('PUT', '/api/v1/admin/libraries/films/profiles', {
      profileIds: [zoeProfile],
    })
    expect(lockout.status).toBe(409)
    expect(await errorCode(lockout)).toBe('profile/last_unrestricted')
    expect((await read()).map((row) => row.hasAccess)).toEqual([true, true])
    expect(
      (await admin.send('PUT', '/api/v1/admin/libraries/nope/profiles', { profileIds: [] })).status,
    ).toBe(404)
    expect(
      (
        await admin.send('PUT', '/api/v1/admin/libraries/films/profiles', {
          profileIds: ['ghost'],
        })
      ).status,
    ).toBe(404)
  })
})

describe('POST /auth/password', () => {
  test('checks the current password, then revokes the other sessions only', async () => {
    const t = createAuthTestApp()
    const { cookie } = await t.completeSetup()
    const here = t.as(cookie)
    const elsewhere = t.as(sessionCookieOf(await t.login('leo', adminPassword)))

    const wrong = await here.send('POST', '/api/v1/auth/password', {
      currentPassword: 'not my password',
      newPassword: 'my new long password',
    })
    expect(wrong.status).toBe(403)
    expect(await errorCode(wrong)).toBe('account/wrong_password')
    const short = await here.send('POST', '/api/v1/auth/password', {
      currentPassword: adminPassword,
      newPassword: 'short',
    })
    expect(short.status).toBe(400)

    const changed = await here.send('POST', '/api/v1/auth/password', {
      currentPassword: adminPassword,
      newPassword: 'my new long password',
    })
    expect(changed.status).toBe(204)
    expect((await here.get('/api/v1/auth/me')).status).toBe(200)
    expect((await elsewhere.get('/api/v1/auth/me')).status).toBe(401)
    expect((await t.login('leo', adminPassword)).status).toBe(401)
    expect((await t.login('leo', 'my new long password')).status).toBe(200)
  })
})
