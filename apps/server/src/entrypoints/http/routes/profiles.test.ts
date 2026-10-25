import { describe, expect, test } from 'bun:test'

import {
  adminPassword,
  createAuthTestApp,
  sessionCookieOf,
} from '../../../../test/support/auth-app.ts'

type ErrorBody = { error: { code: string } }
const errorCode = async (response: Response) => ((await response.json()) as ErrorBody).error.code

type Me = {
  profiles: { id: string; name: string; hasPin: boolean }[]
  activeProfileId?: string
  needsProfileSelection: boolean
}
type ProfileBody = {
  id: string
  name: string
  hasPin: boolean
  maxContentRating?: string
  libraryAccess: string
  libraryIds: string[]
}

/** Admin with three profiles: its own, "Enfants" (limited to 10) and "Parent" (PIN 1234). */
const family = async () => {
  const t = createAuthTestApp()
  const { cookie } = await t.completeSetup()
  const admin = t.as(cookie)
  const create = async (body: Record<string, unknown>) => {
    const response = await admin.send('POST', '/api/v1/profiles', body)
    expect(response.status).toBe(201)
    return (await response.json()) as ProfileBody
  }
  const kid = await create({ name: 'Enfants', maxContentRating: '10' })
  const parent = await create({ name: 'Parent', pin: '1234' })
  return { t, admin, kid, parent }
}

describe('profiles', () => {
  test('list, create with defaults, rename, delete, keep at least one', async () => {
    const t = createAuthTestApp()
    const { cookie } = await t.completeSetup()
    const admin = t.as(cookie)
    const created = await admin.send('POST', '/api/v1/profiles', { name: 'Zoé' })
    expect(created.status).toBe(201)
    const zoe = (await created.json()) as ProfileBody & { avatarColor: string }
    expect(zoe).toMatchObject({
      name: 'Zoé',
      avatarColor: 'terracotta',
      hasPin: false,
      libraryIds: [],
    })

    const list = (await (await admin.get('/api/v1/profiles')).json()) as { items: ProfileBody[] }
    expect(list.items.map((profile) => profile.name)).toEqual(['leo', 'Zoé'])

    const renamed = await admin.send('PATCH', `/api/v1/profiles/${zoe.id}`, {
      name: 'Zoé B',
      autoplayNext: false,
      audioLanguage: 'ja',
    })
    expect(renamed.status).toBe(200)
    expect(await renamed.json()).toMatchObject({
      name: 'Zoé B',
      autoplayNext: false,
      audioLanguage: 'ja',
    })

    const invalid = await admin.send('PATCH', `/api/v1/profiles/${zoe.id}`, { pin: '12' })
    expect(invalid.status).toBe(400)

    expect((await admin.send('DELETE', `/api/v1/profiles/${zoe.id}`)).status).toBe(204)
    const own = list.items[0]?.id ?? ''
    const last = await admin.send('DELETE', `/api/v1/profiles/${own}`)
    expect(last.status).toBe(409)
    expect(await errorCode(last)).toBe('profile/last_profile')
  })

  test('at most 5 profiles per account', async () => {
    const t = createAuthTestApp()
    const admin = t.as((await t.completeSetup()).cookie)
    for (const name of ['B', 'C', 'D', 'E']) {
      expect((await admin.send('POST', '/api/v1/profiles', { name })).status).toBe(201)
    }
    const sixth = await admin.send('POST', '/api/v1/profiles', { name: 'F' })
    expect(sixth.status).toBe(409)
    expect(await errorCode(sixth)).toBe('profile/limit_reached')
  })

  test('parallel creations cannot exceed 5 profiles', async () => {
    const t = createAuthTestApp()
    const admin = t.as((await t.completeSetup()).cookie)
    const responses = await Promise.all(
      ['B', 'C', 'D', 'E', 'F', 'G'].map((name) =>
        admin.send('POST', '/api/v1/profiles', { name, pin: '1234' }),
      ),
    )
    expect(responses.filter((response) => response.status === 201)).toHaveLength(4)
    const list = (await (await admin.get('/api/v1/profiles')).json()) as { items: unknown[] }
    expect(list.items).toHaveLength(5)
  })
})

describe('"Qui regarde ?" (§13.6)', () => {
  test('first sign-in on a device with several profiles: choose, then restored', async () => {
    const { t, kid } = await family()
    const login = await t.login('leo', adminPassword)
    const me = (await login.json()) as Me
    expect(me.needsProfileSelection).toBe(true)
    expect(me.activeProfileId).toBeUndefined()
    expect(me.profiles.map((profile) => [profile.name, profile.hasPin])).toEqual([
      ['leo', false],
      ['Enfants', false],
      ['Parent', true],
    ])

    const device = t.as(sessionCookieOf(login))
    expect(((await (await device.get('/api/v1/auth/me')).json()) as Me).needsProfileSelection).toBe(
      true,
    )
    // Other domains see no active profile until one is chosen.
    expect(await (await device.get('/api/v1/probe')).json()).toEqual({ account: 'leo' })

    const selected = await device.send('POST', `/api/v1/profiles/${kid.id}/select`, {})
    expect(selected.status).toBe(200)
    expect(await selected.json()).toMatchObject({
      activeProfileId: kid.id,
      needsProfileSelection: false,
    })
    // Restored on the next visit, without header.
    expect(await (await device.get('/api/v1/auth/me')).json()).toMatchObject({
      activeProfileId: kid.id,
      needsProfileSelection: false,
    })
    expect(await (await device.get('/api/v1/probe')).json()).toEqual({
      account: 'leo',
      profileId: kid.id,
    })
  })

  test('a PIN-protected profile needs its PIN to be selected, even through X-Profile-Id', async () => {
    const { admin, parent, kid } = await family()
    await admin.send('POST', `/api/v1/profiles/${kid.id}/select`, {})

    const header = { 'X-Profile-Id': parent.id }
    const sneaky = await admin.get('/api/v1/probe', header)
    expect(sneaky.status).toBe(403)
    expect(await errorCode(sneaky)).toBe('profile/pin_required')
    // /auth/me still answers, and asks for a choice.
    const me = await admin.get('/api/v1/auth/me', header)
    expect(me.status).toBe(200)
    expect(await me.json()).toMatchObject({ needsProfileSelection: true })

    const noPin = await admin.send('POST', `/api/v1/profiles/${parent.id}/select`, {}, header)
    expect(noPin.status).toBe(403)
    expect(await errorCode(noPin)).toBe('profile/pin_required')
    const wrong = await admin.send('POST', `/api/v1/profiles/${parent.id}/select`, { pin: '0000' })
    expect(wrong.status).toBe(403)
    expect(await errorCode(wrong)).toBe('profile/invalid_pin')
    const right = await admin.send('POST', `/api/v1/profiles/${parent.id}/select`, { pin: '1234' })
    expect(right.status).toBe(200)
    expect(await (await admin.get('/api/v1/probe', header)).json()).toEqual({
      account: 'leo',
      profileId: parent.id,
    })

    // Switching away and back asks again.
    expect((await admin.get('/api/v1/probe', { 'X-Profile-Id': kid.id })).status).toBe(200)
    expect((await admin.get('/api/v1/probe', header)).status).toBe(403)
  })

  test('verify-pin: 5 checks per minute per profile, then 429', async () => {
    const { t, admin, parent } = await family()
    const verify = (pin: string) =>
      admin.send('POST', `/api/v1/profiles/${parent.id}/verify-pin`, { pin })
    expect((await verify('1234')).status).toBe(204)
    for (let i = 0; i < 5; i += 1) expect((await verify('0000')).status).toBe(403)
    const blocked = await verify('1234')
    expect(blocked.status).toBe(429)
    expect(await errorCode(blocked)).toBe('profile/rate_limited')
    expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0)
    t.clock.advance(60_000)
    expect((await verify('1234')).status).toBe(204)
  })

  test('a locked profile is edited or deleted with its PIN', async () => {
    const { admin, parent } = await family()
    const locked = await admin.send('PATCH', `/api/v1/profiles/${parent.id}`, { pin: '' })
    expect(locked.status).toBe(403)
    expect(await errorCode(locked)).toBe('profile/pin_required')
    const unlocked = await admin.send('PATCH', `/api/v1/profiles/${parent.id}`, {
      pin: '',
      currentPin: '1234',
    })
    expect(unlocked.status).toBe(200)
    expect(await unlocked.json()).toMatchObject({ hasPin: false })
    expect((await admin.send('DELETE', `/api/v1/profiles/${parent.id}`)).status).toBe(204)
  })
})

describe('access and maximum rating (§14)', () => {
  test('a user narrows but cannot widen; the admin can, from an unrestricted profile', async () => {
    const t = createAuthTestApp()
    const admin = t.as((await t.completeSetup()).cookie)
    const { account } = await t.addUser()
    const zoe = t.as(sessionCookieOf(await t.login('zoe', 'another long password')))

    const kidResponse = await zoe.send('POST', '/api/v1/profiles', {
      name: 'Petit',
      maxContentRating: '10',
    })
    expect(kidResponse.status).toBe(201)
    const kid = (await kidResponse.json()) as ProfileBody

    const lift = await zoe.send('PATCH', `/api/v1/profiles/${kid.id}`, { maxContentRating: '' })
    expect(lift.status).toBe(403)
    expect(await errorCode(lift)).toBe('profile/admin_only')
    expect(
      (await zoe.send('PATCH', `/api/v1/profiles/${kid.id}`, { maxContentRating: '0' })).status,
    ).toBe(200)

    // The admin manages any account's profiles.
    const widened = await admin.send('PATCH', `/api/v1/profiles/${kid.id}`, {
      maxContentRating: '16',
    })
    expect(widened.status).toBe(200)
    expect(await widened.json()).toMatchObject({ maxContentRating: '16' })
    const accounts = (await (await admin.get('/api/v1/admin/accounts')).json()) as {
      items: { id: string; profiles: { name: string; maxContentRating?: string }[] }[]
    }
    expect(accounts.items.find((item) => item.id === account.id)?.profiles).toEqual([
      expect.objectContaining({ name: 'zoe' }),
      expect.objectContaining({ name: 'Petit', maxContentRating: '16' }),
    ])

    // The resolver of the catalogue follows at once.
    expect(t.visibilityScope(kid.id).allowedRatings?.['FR']).toEqual(['U', 'TP', '10', '12', '16'])

    const unknown = await admin.send('PATCH', `/api/v1/profiles/${kid.id}`, {
      libraryAccess: 'selected',
      libraryIds: ['ghost'],
    })
    expect(unknown.status).toBe(400)
    expect(await errorCode(unknown)).toBe('profile/unknown_library')

    // A user does not reach another account's profiles.
    const own = (await (await admin.get('/api/v1/profiles')).json()) as { items: ProfileBody[] }
    const foreign = await zoe.send('PATCH', `/api/v1/profiles/${own.items[0]?.id}`, { name: 'x' })
    expect(foreign.status).toBe(404)
  })
})

describe('no widening without a resolved unrestricted profile (§14)', () => {
  test('from the child: a locked, foreign or bogus X-Profile-Id does not lift its limits', async () => {
    const { admin, kid, parent } = await family()
    await admin.send('POST', `/api/v1/profiles/${kid.id}/select`, {})
    for (const header of [{ 'X-Profile-Id': parent.id }, { 'X-Profile-Id': 'bogus' }, {}]) {
      const created = await admin.send('POST', '/api/v1/profiles', { name: 'Libre' }, header)
      expect(created.status).toBe(403)
      expect(await errorCode(created)).toBe('profile/restricted')
      const lifted = await admin.send(
        'PATCH',
        `/api/v1/profiles/${kid.id}`,
        { maxContentRating: '' },
        header,
      )
      expect(lifted.status).toBe(403)
    }
    const profiles = (await (await admin.get('/api/v1/profiles')).json()) as { items: unknown[] }
    expect(profiles.items).toHaveLength(3)
  })

  test('a fresh sign-in before "Qui regarde ?" acts as the most restricted profile', async () => {
    const { t, kid } = await family()
    const device = t.as(sessionCookieOf(await t.login('leo', adminPassword)))
    const created = await device.send('POST', '/api/v1/profiles', { name: 'Libre' })
    expect(created.status).toBe(403)
    expect(await errorCode(created)).toBe('profile/restricted')
    const lifted = await device.send('PATCH', `/api/v1/profiles/${kid.id}`, {
      maxContentRating: '',
    })
    expect(lifted.status).toBe(403)
    // Once its own profile is chosen, the admin manages profiles again.
    const own = (await (await device.get('/api/v1/profiles')).json()) as { items: ProfileBody[] }
    await device.send('POST', `/api/v1/profiles/${own.items[0]?.id}/select`, {})
    expect(
      (await device.send('PATCH', `/api/v1/profiles/${kid.id}`, { maxContentRating: '' })).status,
    ).toBe(200)
  })

  test('the admin cannot widen another profile through a locked X-Profile-Id', async () => {
    const t = createAuthTestApp()
    const admin = t.as((await t.completeSetup()).cookie)
    const create = async (body: Record<string, unknown>) =>
      (await (await admin.send('POST', '/api/v1/profiles', body)).json()) as ProfileBody
    const ado = await create({ name: 'Ado', maxContentRating: '12' })
    const own = (await (await admin.get('/api/v1/profiles')).json()) as { items: ProfileBody[] }
    const leo = own.items[0]?.id ?? ''
    expect((await admin.send('PATCH', `/api/v1/profiles/${leo}`, { pin: '4321' })).status).toBe(200)
    // Another device, signed in: Léo's profile is locked there.
    const device = t.as(sessionCookieOf(await t.login('leo', adminPassword)))
    const widened = await device.send(
      'PATCH',
      `/api/v1/profiles/${ado.id}`,
      { maxContentRating: '' },
      { 'X-Profile-Id': leo },
    )
    expect(widened.status).toBe(403)
  })

  test('an account without restricted profile manages its profiles before choosing one', async () => {
    const t = createAuthTestApp()
    const admin = t.as((await t.completeSetup()).cookie)
    expect((await admin.send('POST', '/api/v1/profiles', { name: 'Zoé' })).status).toBe(201)
    const device = t.as(sessionCookieOf(await t.login('leo', adminPassword)))
    expect((await device.send('POST', '/api/v1/profiles', { name: 'Tom' })).status).toBe(201)
  })
})

describe('account actions from a restricted profile (§14)', () => {
  test('refused: devices, tokens, password, other profiles, PINs; own settings allowed', async () => {
    const { admin, kid, parent } = await family()
    await admin.send('POST', `/api/v1/profiles/${kid.id}/select`, {})
    const expectRestricted = async (response: Response) => {
      expect(response.status).toBe(403)
      expect(await errorCode(response)).toBe('profile/restricted')
    }
    const sessions = (await (await admin.get('/api/v1/auth/sessions')).json()) as {
      items: { id: string }[]
    }
    await expectRestricted(
      await admin.send('DELETE', `/api/v1/auth/sessions/${sessions.items[0]?.id}`),
    )
    await expectRestricted(await admin.send('POST', '/api/v1/auth/tokens', { deviceName: 'TV' }))
    await expectRestricted(
      await admin.send('POST', '/api/v1/auth/password', {
        currentPassword: adminPassword,
        newPassword: 'a brand new long password',
      }),
    )
    await expectRestricted(
      await admin.send('PATCH', `/api/v1/profiles/${parent.id}`, {
        name: 'x',
        currentPin: '1234',
      }),
    )
    await expectRestricted(
      await admin.send('DELETE', `/api/v1/profiles/${parent.id}`, { currentPin: '1234' }),
    )
    await expectRestricted(await admin.send('PATCH', `/api/v1/profiles/${kid.id}`, { pin: '1111' }))
    const own = await admin.send('PATCH', `/api/v1/profiles/${kid.id}`, {
      name: 'Les petits',
      audioLanguage: 'en',
      autoplayNext: false,
    })
    expect(own.status).toBe(200)
    expect(await own.json()).toMatchObject({ name: 'Les petits', audioLanguage: 'en' })
    // Narrowing itself stays possible; switching profile too.
    expect(
      (await admin.send('PATCH', `/api/v1/profiles/${kid.id}`, { maxContentRating: '0' })).status,
    ).toBe(200)
    expect(
      (await admin.send('POST', `/api/v1/profiles/${parent.id}/select`, { pin: '1234' })).status,
    ).toBe(200)
    expect((await admin.send('POST', '/api/v1/auth/tokens', { deviceName: 'TV' })).status).toBe(201)
  })
})
