import { describe, expect, test } from 'bun:test'

import {
  adminPassword,
  createAuthTestApp,
  sessionCookieOf,
} from '../../../../test/support/auth-app.ts'

type ErrorBody = { error: { code: string; context?: Record<string, unknown> } }
const errorCode = async (response: Response) => ((await response.json()) as ErrorBody).error.code

describe('stream URLs (§20)', () => {
  test('a capability URL needs no session; any other stream path still does', async () => {
    const t = createAuthTestApp()
    await t.completeSetup()
    const capability = await t.request('/api/v1/stream/s1/secret/index.m3u8')
    expect(capability.status).not.toBe(401)
    expect((await t.request('/api/v1/stream/s1/index.m3u8')).status).toBe(401)
  })
})

describe('setup', () => {
  test('status, then the wizard creates the admin and its profile and signs in', async () => {
    const t = createAuthTestApp()
    expect(await (await t.request('/api/v1/setup/status')).json()).toEqual({ completed: false })

    const { response, cookie } = await t.completeSetup({
      metadataLanguage: 'en-US',
      uiLocale: 'en',
    })
    const me = (await response.json()) as {
      account: { username: string; role: string }
      profiles: { id: string; name: string; uiLocale: string }[]
      activeProfileId: string
    }
    expect(me.account).toMatchObject({ username: 'leo', role: 'admin' })
    expect(me.profiles).toEqual([
      expect.objectContaining({ name: 'leo', uiLocale: 'en', hasPin: false }),
    ])
    expect(me.activeProfileId).toBe(me.profiles[0]?.id ?? '')

    expect(await (await t.request('/api/v1/setup/status')).json()).toEqual({
      completed: true,
      serverName: 'Maison',
    })
    const meAgain = await t.request('/api/v1/auth/me', { headers: { cookie } })
    expect(meAgain.status).toBe(200)
  })

  test('runs only once', async () => {
    const t = createAuthTestApp()
    await t.completeSetup()
    const again = await t.json('POST', '/api/v1/setup', {
      username: 'mallory',
      password: adminPassword,
    })
    expect(again.status).toBe(409)
    expect(await errorCode(again)).toBe('setup/already_completed')
  })

  test('validates the account (§14)', async () => {
    const t = createAuthTestApp()
    const short = await t.json('POST', '/api/v1/setup', { username: 'leo', password: 'short' })
    expect(short.status).toBe(400)
    expect(await errorCode(short)).toBe('common/validation_failed')
    const badName = await t.json('POST', '/api/v1/setup', {
      username: 'l e',
      password: adminPassword,
    })
    expect(badName.status).toBe(400)
  })
})

describe('login and session cookie', () => {
  test('sets an httpOnly SameSite=Lax 30-day cookie, not Secure over plain HTTP', async () => {
    const t = createAuthTestApp()
    await t.completeSetup()
    const response = await t.login('LEO', adminPassword)
    expect(response.status).toBe(200)
    const cookie = response.headers.getSetCookie().find((c) => c.startsWith('projo_session='))
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('SameSite=Lax')
    expect(cookie).toContain('Path=/')
    expect(cookie).toContain('Max-Age=2592000')
    expect(cookie).not.toContain('Secure')
    expect(await response.json()).toMatchObject({ account: { username: 'leo' } })
  })

  test('Secure behind an HTTPS reverse proxy only with TRUST_PROXY', async () => {
    const headers = {
      'x-forwarded-proto': 'https',
      'x-forwarded-host': 'projo.example',
      origin: 'https://projo.example',
    }
    const trusted = createAuthTestApp({ trustProxy: true })
    await trusted.completeSetup()
    const viaProxy = await trusted.login('leo', adminPassword, headers)
    expect(viaProxy.status).toBe(200)
    expect(viaProxy.headers.get('set-cookie')).toContain('Secure')

    const untrusted = createAuthTestApp()
    await untrusted.completeSetup()
    const ignored = await untrusted.login('leo', adminPassword, {
      'x-forwarded-proto': 'https',
      origin: 'http://localhost',
    })
    expect(ignored.status).toBe(200)
    expect(ignored.headers.get('set-cookie')).not.toContain('Secure')
    // Without TRUST_PROXY the forwarded host is not the expected origin either.
    expect((await untrusted.login('leo', adminPassword, headers)).status).toBe(403)
  })

  test('wrong password and unknown user: 401 auth/invalid_credentials', async () => {
    const t = createAuthTestApp()
    await t.completeSetup()
    for (const [username, password] of [
      ['leo', 'wrong password!'],
      ['ghost', adminPassword],
    ] as const) {
      const response = await t.login(username, password)
      expect(response.status).toBe(401)
      expect(await errorCode(response)).toBe('auth/invalid_credentials')
      expect(response.headers.get('set-cookie')).toBeNull()
    }
  })

  test('10 failures per username in 15 min: 429 with Retry-After, lifted after the window', async () => {
    const t = createAuthTestApp()
    await t.completeSetup()
    for (let i = 0; i < 10; i += 1) {
      expect((await t.login('leo', `wrong password ${i}`)).status).toBe(401)
    }
    const blocked = await t.login('leo', adminPassword)
    expect(blocked.status).toBe(429)
    expect(await errorCode(blocked)).toBe('auth/rate_limited')
    expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0)

    t.clock.advance(15 * 60_000)
    expect((await t.login('leo', adminPassword)).status).toBe(200)
  })

  test('without TRUST_PROXY, X-Forwarded-For is ignored: changing it does not dodge the IP limit', async () => {
    const t = createAuthTestApp()
    await t.completeSetup()
    // A different username each time: only the per-IP counter can block.
    for (let i = 0; i < 10; i += 1) {
      const response = await t.login(`ghost${i}`, 'wrong password!', {
        'x-forwarded-for': `198.51.100.${i}`,
      })
      expect(response.status).toBe(401)
    }
    const blocked = await t.login('leo', adminPassword, { 'x-forwarded-for': '198.51.100.99' })
    expect(blocked.status).toBe(429)
    expect(await errorCode(blocked)).toBe('auth/rate_limited')
  })

  test('with TRUST_PROXY, the last X-Forwarded-For entry (added by the proxy) is the client', async () => {
    const t = createAuthTestApp({ trustProxy: true })
    await t.completeSetup()
    for (let i = 0; i < 10; i += 1) {
      const response = await t.login(`ghost${i}`, 'wrong password!', {
        'x-forwarded-for': `spoofed-${i}, 203.0.113.4`,
      })
      expect(response.status).toBe(401)
    }
    const blocked = await t.login('leo', adminPassword, {
      'x-forwarded-for': 'spoofed-again, 203.0.113.4',
    })
    expect(blocked.status).toBe(429)
    expect((await t.login('leo', adminPassword, { 'x-forwarded-for': '203.0.113.5' })).status).toBe(
      200,
    )
  })

  test('token: true opens a bearer session named after the device, sets no cookie', async () => {
    const t = createAuthTestApp()
    const { cookie } = await t.completeSetup()
    const response = await t.json('POST', '/api/v1/auth/login', {
      username: 'leo',
      password: adminPassword,
      deviceName: 'iPhone 15 Pro',
      token: true,
    })
    expect(response.status).toBe(200)
    expect(response.headers.get('set-cookie')).toBeNull()
    const body = (await response.json()) as { token: string; account: { username: string } }
    expect(body.account.username).toBe('leo')
    const me = await t.request('/api/v1/auth/me', {
      headers: { authorization: `Bearer ${body.token}` },
    })
    expect(me.status).toBe(200)

    const { items } = (await (await t.as(cookie).get('/api/v1/auth/sessions')).json()) as {
      items: { kind: string; deviceName: string }[]
    }
    expect(items).toContainEqual(
      expect.objectContaining({ kind: 'bearer', deviceName: 'iPhone 15 Pro' }),
    )
    // The browser's cookie session is kept.
    expect((await t.as(cookie).get('/api/v1/auth/me')).status).toBe(200)

    const plain = await t.login('leo', adminPassword)
    expect(await plain.json()).not.toHaveProperty('token')
  })

  test('logout revokes the session and clears the cookie', async () => {
    const t = createAuthTestApp()
    const { cookie } = await t.completeSetup()
    const logout = await t.request('/api/v1/auth/logout', {
      method: 'POST',
      headers: { cookie, origin: 'http://localhost' },
    })
    expect(logout.status).toBe(204)
    expect(logout.headers.get('set-cookie')).toContain('Max-Age=0')

    const after = await t.request('/api/v1/auth/me', { headers: { cookie } })
    expect(after.status).toBe(401)
    expect(await errorCode(after)).toBe('auth/session_revoked')
  })

  test('the cookie slides: renewed after 24 h, expired after 30 idle days', async () => {
    const t = createAuthTestApp()
    const { cookie } = await t.completeSetup()
    t.clock.advance(2 * 3_600_000)
    expect(
      (await t.request('/api/v1/auth/me', { headers: { cookie } })).headers.get('set-cookie'),
    ).toBeNull()

    t.clock.advance(23 * 3_600_000)
    const renewed = await t.request('/api/v1/auth/me', { headers: { cookie } })
    expect(renewed.headers.get('set-cookie')).toContain('Max-Age=2592000')
    expect(sessionCookieOf(renewed)).toBe(cookie)

    t.clock.advance(30 * 24 * 3_600_000)
    const expired = await t.request('/api/v1/auth/me', { headers: { cookie } })
    expect(expired.status).toBe(401)
    expect(await errorCode(expired)).toBe('auth/session_expired')
    expect(expired.headers.get('set-cookie')).toContain('Max-Age=0')
  })
})

describe('authenticate middleware', () => {
  test('non-public routes answer 401 auth/unauthenticated without a session', async () => {
    const t = createAuthTestApp()
    await t.completeSetup()
    for (const path of [
      '/api/v1/auth/me',
      '/api/v1/probe',
      '/api/v1/events',
      '/api/v1/admin/libraries',
    ]) {
      const response = await t.request(path)
      expect(response.status).toBe(401)
      expect(await errorCode(response)).toBe('auth/unauthenticated')
    }
    const forged = await t.request('/api/v1/probe', { headers: { cookie: 'projo_session=forged' } })
    expect(forged.status).toBe(401)
    expect(forged.headers.get('set-cookie')).toContain('Max-Age=0')
  })

  test('mutating requests need a matching Origin', async () => {
    const t = createAuthTestApp()
    const { cookie } = await t.completeSetup()
    const post = (headers: Record<string, string>) =>
      t.request('/api/v1/probe', { method: 'POST', headers: { cookie, ...headers } })
    expect((await post({ origin: 'http://localhost' })).status).toBe(200)
    expect((await post({})).status).toBe(200)
    const foreign = await post({ origin: 'https://evil.example' })
    expect(foreign.status).toBe(403)
    expect(await errorCode(foreign)).toBe('auth/origin_mismatch')
    expect((await post({ 'sec-fetch-site': 'cross-site' })).status).toBe(403)
    // A same-origin `navigator.sendBeacon` (text/plain body).
    expect(
      (
        await post({
          origin: 'http://localhost',
          'sec-fetch-site': 'same-origin',
          'content-type': 'text/plain;charset=UTF-8',
        })
      ).status,
    ).toBe(200)
    // WebKit's `sendBeacon` sends `Origin: null`: accepted only when the browser itself says
    // same-origin (`Sec-Fetch-Site` cannot be set by a page).
    const beacon = (headers: Record<string, string>) =>
      post({ origin: 'null', 'content-type': 'text/plain;charset=UTF-8', ...headers })
    expect((await beacon({ 'sec-fetch-site': 'same-origin' })).status).toBe(200)
    for (const site of ['cross-site', 'same-site', 'none']) {
      expect((await beacon({ 'sec-fetch-site': site })).status).toBe(403)
    }
    expect((await beacon({})).status).toBe(403)
    expect(
      (await t.request('/api/v1/probe', { headers: { cookie, origin: 'https://evil.example' } }))
        .status,
    ).toBe(200)
  })

  test('admin routes: 403 auth/forbidden for a user account', async () => {
    const t = createAuthTestApp()
    const { cookie: adminCookie } = await t.completeSetup()
    const user = await t.addUser()
    const userCookie = sessionCookieOf(await t.login(user.account.username, user.password))

    expect(
      (await t.request('/api/v1/admin/libraries', { headers: { cookie: adminCookie } })).status,
    ).toBe(200)
    const forbidden = await t.request('/api/v1/admin/libraries', {
      headers: { cookie: userCookie },
    })
    expect(forbidden.status).toBe(403)
    expect(await errorCode(forbidden)).toBe('auth/forbidden')
  })

  test('profile: the only one by default, X-Profile-Id checked against the account', async () => {
    const t = createAuthTestApp()
    const { cookie, response } = await t.completeSetup()
    const { activeProfileId } = (await response.json()) as { activeProfileId: string }
    const user = await t.addUser()

    const probe = await t.request('/api/v1/probe', { headers: { cookie } })
    expect(await probe.json()).toEqual({ account: 'leo', profileId: activeProfileId })

    const own = await t.request('/api/v1/probe', {
      headers: { cookie, 'x-profile-id': activeProfileId },
    })
    expect(own.status).toBe(200)
    const foreign = await t.request('/api/v1/probe', {
      headers: { cookie, 'x-profile-id': user.profileId },
    })
    expect(foreign.status).toBe(403)
    expect(await errorCode(foreign)).toBe('profile/forbidden')
  })
})

describe('/auth/me, devices and bearer tokens', () => {
  test('bearer token works without cookie and is listed among the devices', async () => {
    const t = createAuthTestApp()
    const { cookie } = await t.completeSetup()
    const created = await t.json(
      'POST',
      '/api/v1/auth/tokens',
      { deviceName: 'iPhone' },
      { cookie },
    )
    expect(created.status).toBe(201)
    const { token, session } = (await created.json()) as {
      token: string
      session: { id: string; kind: string }
    }
    expect(session.kind).toBe('bearer')

    const me = await t.request('/api/v1/auth/me', { headers: { authorization: `Bearer ${token}` } })
    expect(me.status).toBe(200)
    expect(await me.json()).toMatchObject({
      account: { username: 'leo' },
      profiles: [{ name: 'leo' }],
    })

    const list = await t.request('/api/v1/auth/sessions', { headers: { cookie } })
    const { items } = (await list.json()) as {
      items: { id: string; deviceName: string; current: boolean }[]
    }
    expect(items).toHaveLength(2)
    expect(items.filter((item) => item.current)).toHaveLength(1)
    expect(items.find((item) => item.id === session.id)?.deviceName).toBe('iPhone')
  })

  test('revokes a device; unknown or foreign sessions are 404', async () => {
    const t = createAuthTestApp()
    const { cookie } = await t.completeSetup()
    const created = await t.json('POST', '/api/v1/auth/tokens', { deviceName: 'TV' }, { cookie })
    const { token, session } = (await created.json()) as { token: string; session: { id: string } }

    const del = (id: string) =>
      t.request(`/api/v1/auth/sessions/${id}`, {
        method: 'DELETE',
        headers: { cookie, origin: 'http://localhost' },
      })
    expect((await del(session.id)).status).toBe(204)
    expect(
      (await t.request('/api/v1/auth/me', { headers: { authorization: `Bearer ${token}` } }))
        .status,
    ).toBe(401)

    const missing = await del('nope')
    expect(missing.status).toBe(404)
    expect(await errorCode(missing)).toBe('auth/session_not_found')
  })
})
