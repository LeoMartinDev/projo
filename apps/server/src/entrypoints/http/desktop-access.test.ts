import { describe, expect, test } from 'bun:test'

import { desktopOrigins } from '@projo/shared/api/desktop'

import {
  adminPassword,
  createAuthTestApp,
  sessionCookieOf,
} from '../../../test/support/auth-app.ts'

type ErrorBody = { error: { code: string } }
const errorCode = async (response: Response) => ((await response.json()) as ErrorBody).error.code

const desktop = desktopOrigins[0] ?? ''

/** A desktop sign-in (§20): bearer token, no cookie, from the bundled UI's origin. */
const signedInDesktop = async () => {
  const t = createAuthTestApp()
  const { cookie } = await t.completeSetup()
  const response = await t.json(
    'POST',
    '/api/v1/auth/login',
    { username: 'leo', password: adminPassword, token: true, deviceName: 'projo desktop' },
    { origin: desktop },
  )
  expect(response.status).toBe(200)
  expect(response.headers.getSetCookie()).toEqual([])
  const { token } = (await response.json()) as { token: string }
  const bearer = { authorization: `Bearer ${token}`, origin: desktop }
  const mediaKey = async () => {
    const me = await t.request('/api/v1/auth/me', { headers: bearer })
    return ((await me.json()) as { mediaKey: string }).mediaKey
  }
  return { t, cookie, token, bearer, mediaKey }
}

describe('CORS for the desktop origins (§20)', () => {
  test('a preflight is answered before authentication', async () => {
    const t = createAuthTestApp()
    for (const path of ['/api/v1/auth/me', '/api/v1/profiles/p1/select', '/health']) {
      const response = await t.request(path, {
        method: 'OPTIONS',
        headers: {
          origin: desktop,
          'access-control-request-method': 'POST',
          'access-control-request-headers': 'authorization, content-type, x-profile-id',
        },
      })
      expect(response.status).toBe(204)
      expect(response.headers.get('access-control-allow-origin')).toBe(desktop)
      expect(response.headers.get('access-control-allow-methods')).toBe(
        'GET, HEAD, POST, PUT, PATCH, DELETE',
      )
      expect(response.headers.get('access-control-allow-headers')).toBe(
        'authorization, content-type, x-profile-id',
      )
      expect(Number(response.headers.get('access-control-max-age'))).toBeGreaterThan(0)
      expect(response.headers.get('vary')).toContain('Origin')
      expect(response.headers.get('access-control-allow-credentials')).toBeNull()
    }
  })

  test('answers carry the origin and expose retry-after and content-disposition', async () => {
    const t = createAuthTestApp()
    for (const path of ['/health', '/api/v1/setup/status', '/api/v1/auth/me']) {
      const response = await t.request(path, { headers: { origin: desktop } })
      expect(response.headers.get('access-control-allow-origin')).toBe(desktop)
      expect(response.headers.get('access-control-expose-headers')).toBe(
        'retry-after, content-disposition',
      )
      expect(response.headers.get('vary')).toContain('Origin')
      expect(response.headers.get('access-control-allow-credentials')).toBeNull()
    }
  })

  test('nothing for another origin', async () => {
    const t = createAuthTestApp()
    const foreign = await t.request('/api/v1/auth/me', {
      method: 'OPTIONS',
      headers: { origin: 'https://evil.example', 'access-control-request-method': 'GET' },
    })
    expect(foreign.status).toBe(401)
    expect(foreign.headers.get('access-control-allow-origin')).toBeNull()
    const plain = await t.request('/health', { headers: { origin: 'https://evil.example' } })
    expect(plain.headers.get('access-control-allow-origin')).toBeNull()
    const stream = await t.request('/api/v1/stream/s1/secret/index.m3u8', {
      headers: { origin: 'https://evil.example' },
    })
    expect(stream.headers.get('access-control-allow-origin')).toBeNull()
  })

  test('stream capability URLs: GET and HEAD only, for the html-video fallback', async () => {
    const t = createAuthTestApp()
    const path = '/api/v1/stream/s1/secret/index.m3u8'
    const preflight = await t.request(path, {
      method: 'OPTIONS',
      headers: { origin: desktop, 'access-control-request-method': 'GET' },
    })
    expect(preflight.status).toBe(204)
    expect(preflight.headers.get('access-control-allow-origin')).toBe(desktop)
    expect(preflight.headers.get('access-control-allow-methods')).toBe('GET, HEAD')
    expect(preflight.headers.get('access-control-allow-credentials')).toBeNull()
    for (const method of ['GET', 'HEAD']) {
      const response = await t.request(path, { method, headers: { origin: desktop } })
      expect(response.headers.get('access-control-allow-origin')).toBe(desktop)
      expect(response.headers.get('access-control-allow-credentials')).toBeNull()
      expect(response.headers.get('cross-origin-resource-policy')).toBe('cross-origin')
    }
    const post = await t.request(path, { method: 'POST', headers: { origin: desktop } })
    expect(post.headers.get('access-control-allow-origin')).toBeNull()
  })
})

describe('Origin rule for the desktop origins (§20)', () => {
  test('a bearer mutation from the desktop origin passes', async () => {
    const { t, bearer } = await signedInDesktop()
    const response = await t.request('/api/v1/probe', { method: 'POST', headers: bearer })
    expect(response.status).toBe(200)
    expect(response.headers.get('access-control-allow-origin')).toBe(desktop)
  })

  test('a cookie with the desktop origin is refused, sign-in without a token too', async () => {
    const { t, cookie } = await signedInDesktop()
    const withCookie = await t.request('/api/v1/probe', {
      method: 'POST',
      headers: { cookie, origin: desktop },
    })
    expect(withCookie.status).toBe(403)
    expect(await errorCode(withCookie)).toBe('auth/origin_mismatch')

    const cookieLogin = await t.json(
      'POST',
      '/api/v1/auth/login',
      { username: 'leo', password: adminPassword },
      { origin: desktop },
    )
    expect(cookieLogin.status).toBe(403)
    expect(await errorCode(cookieLogin)).toBe('auth/origin_mismatch')
    expect(cookieLogin.headers.getSetCookie()).toEqual([])
  })

  test('the pairing claim is accepted from the desktop origin', async () => {
    const t = createAuthTestApp()
    const { cookie } = await t.completeSetup()
    const pairing = (await (await t.as(cookie).send('POST', '/api/v1/auth/pairings')).json()) as {
      code: string
    }
    const claim = await t.json(
      'POST',
      '/api/v1/auth/pairings/claim',
      { code: pairing.code, deviceName: 'projo desktop' },
      { origin: desktop },
    )
    expect(claim.status).toBe(200)
    expect(((await claim.json()) as { token: string }).token).toBeString()
  })

  test('setup and invitation acceptance are refused from the desktop origin', async () => {
    const t = createAuthTestApp()
    const setup = await t.json(
      'POST',
      '/api/v1/setup',
      { username: 'leo', password: adminPassword, serverName: 'Maison' },
      { origin: desktop },
    )
    expect(setup.status).toBe(403)
    expect(await errorCode(setup)).toBe('auth/origin_mismatch')
    expect(await (await t.request('/api/v1/setup/status')).json()).toEqual({ completed: false })

    await t.completeSetup()
    const accept = await t.json(
      'POST',
      '/api/v1/invitations/some-token/accept',
      { username: 'zoe', password: 'another long password' },
      { origin: desktop },
    )
    expect(accept.status).toBe(403)
    expect(await errorCode(accept)).toBe('auth/origin_mismatch')
    expect(accept.headers.getSetCookie()).toEqual([])
  })

  test('cookie sessions from the server origin are unchanged', async () => {
    const t = createAuthTestApp()
    const { cookie } = await t.completeSetup()
    expect((await t.as(cookie).send('POST', '/api/v1/probe')).status).toBe(200)
    const login = await t.login('leo', adminPassword)
    expect(login.status).toBe(200)
    expect(sessionCookieOf(login)).toStartWith('projo_session=')
  })
})

describe('media key (§20)', () => {
  test('GET /auth/me gives one to a bearer session only', async () => {
    const { t, cookie, mediaKey } = await signedInDesktop()
    expect(await mediaKey()).toMatch(/^[^.]+\.[A-Za-z0-9_-]{43}$/)
    const me = (await (await t.as(cookie).get('/api/v1/auth/me')).json()) as object
    expect(me).not.toHaveProperty('mediaKey')
  })

  test('accepted on GET and HEAD of a media route, with the session last profile', async () => {
    const { t, mediaKey } = await signedInDesktop()
    const key = await mediaKey()
    const image = await t.request(`/api/v1/images/i1?w=342&key=${encodeURIComponent(key)}`, {
      headers: { origin: desktop },
    })
    expect(image.status).toBe(200)
    expect(await image.json()).toMatchObject({ account: 'leo', profileId: expect.any(String) })
    const head = await t.request(`/api/v1/images/i1?key=${encodeURIComponent(key)}`, {
      method: 'HEAD',
    })
    expect(head.status).toBe(200)
  })

  test('refused anywhere else, and once the session is gone', async () => {
    const { t, bearer, mediaKey } = await signedInDesktop()
    const key = encodeURIComponent(await mediaKey())
    for (const path of [`/api/v1/auth/me?key=${key}`, `/api/v1/probe?key=${key}`]) {
      const response = await t.request(path)
      expect(response.status).toBe(401)
      expect(await errorCode(response)).toBe('auth/unauthenticated')
    }
    expect((await t.request(`/api/v1/images/i1?key=${key}x`)).status).toBe(401)
    const post = await t.request(`/api/v1/images/i1?key=${key}`, {
      method: 'POST',
      headers: { origin: desktop },
    })
    expect(post.status).toBe(401)
    expect(await errorCode(post)).toBe('auth/unauthenticated')
    for (const path of [
      `/api/v1/images/../auth/me?key=${key}`,
      `/api/v1/images/%2e%2e/auth/me?key=${key}`,
      `/api/v1/images/x%2F..%2F..%2Fauth%2Fme?key=${key}`,
      `/api/v1/images%2F..%2Fauth/me?key=${key}`,
    ]) {
      const response = await t.request(path)
      expect(response.status).not.toBe(200)
    }

    expect(
      (await t.request('/api/v1/auth/logout', { method: 'POST', headers: bearer })).status,
    ).toBe(204)
    const revoked = await t.request(`/api/v1/images/i1?key=${key}`)
    expect(revoked.status).toBe(401)
    expect(await errorCode(revoked)).toBe('auth/session_revoked')
  })
})

describe('media key alongside another credential (§20)', () => {
  test('ignored when a bearer or a cookie is also sent', async () => {
    const { t, mediaKey } = await signedInDesktop()
    const key = encodeURIComponent(await mediaKey())
    const withBearer = await t.request(`/api/v1/images/i1?key=${key}`, {
      headers: { authorization: 'Bearer forged' },
    })
    expect(withBearer.status).toBe(401)
    const withCookie = await t.request(`/api/v1/images/i1?key=${key}`, {
      headers: { cookie: 'projo_session=forged' },
    })
    expect(withCookie.status).toBe(401)
    expect(withCookie.headers.get('set-cookie')).toContain('Max-Age=0')
  })
})

describe('Cross-Origin-Resource-Policy (§20)', () => {
  test('cross-origin on media and stream answers without a cookie, same-origin elsewhere', async () => {
    const { t, bearer, mediaKey } = await signedInDesktop()
    const image = await t.request('/api/v1/images/i1', { headers: bearer })
    expect(image.headers.get('cross-origin-resource-policy')).toBe('cross-origin')
    const keyed = await t.request(`/api/v1/images/i1?key=${encodeURIComponent(await mediaKey())}`)
    expect(keyed.status).toBe(200)
    expect(keyed.headers.get('cross-origin-resource-policy')).toBe('cross-origin')
    const stream = await t.request('/api/v1/stream/s1/secret/direct')
    expect(stream.headers.get('cross-origin-resource-policy')).toBe('cross-origin')
    for (const path of ['/api/v1/auth/me', '/health', '/']) {
      const response = await t.request(path, { headers: bearer })
      expect(response.headers.get('cross-origin-resource-policy')).toBe('same-origin')
    }
  })

  test('same-origin on a cookie request, media and streams included', async () => {
    const { t, cookie } = await signedInDesktop()
    for (const path of ['/api/v1/images/i1', '/api/v1/stream/s1/secret/direct']) {
      const response = await t.as(cookie).get(path)
      expect(response.headers.get('cross-origin-resource-policy')).toBe('same-origin')
    }
    expect((await t.as(cookie).get('/api/v1/images/i1')).status).toBe(200)
  })
})
