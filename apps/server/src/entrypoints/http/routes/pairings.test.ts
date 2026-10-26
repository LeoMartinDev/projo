import { describe, expect, test } from 'bun:test'

import { pairingCodeAlphabet } from '@projo/shared/api/auth'

import {
  adminPassword,
  createAuthTestApp,
  sessionCookieOf,
} from '../../../../test/support/auth-app.ts'

type ErrorBody = { error: { code: string } }
const errorCode = async (response: Response) => ((await response.json()) as ErrorBody).error.code

type Pairing = { id: string; code: string; expiresAt: string }

/** The app: no cookie, no `Origin` (a native client), behind `X-Forwarded-For` when trusted. */
const claim = (
  t: ReturnType<typeof createAuthTestApp>,
  body: unknown,
  headers: Record<string, string> = {},
) =>
  t.request('/api/v1/auth/pairings/claim', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })

const signedIn = async (options: Parameters<typeof createAuthTestApp>[0] = {}) => {
  const t = createAuthTestApp(options)
  const { cookie } = await t.completeSetup()
  const web = t.as(cookie)
  const createCode = () => web.send('POST', '/api/v1/auth/pairings')
  const newCode = async () => {
    const response = await createCode()
    expect(response.status).toBe(201)
    return (await response.json()) as Pairing
  }
  return { t, web, cookie, createCode, newCode }
}

describe('POST /auth/pairings', () => {
  test('a 6-character code over the alphabet, valid 5 minutes', async () => {
    const { t, newCode } = await signedIn()
    const pairing = await newCode()
    expect(pairing.code).toMatch(new RegExp(`^[${pairingCodeAlphabet}]{6}$`))
    expect(pairingCodeAlphabet).not.toMatch(/[0O1I]/)
    expect(new Date(pairing.expiresAt).getTime() - t.clock.now().getTime()).toBe(5 * 60_000)
  })

  test('requires a session', async () => {
    const t = createAuthTestApp()
    await t.completeSetup()
    const response = await t.json('POST', '/api/v1/auth/pairings', {})
    expect(response.status).toBe(401)
  })

  test('at most 3 live codes per account: 409, a slot frees once one expires', async () => {
    const { t, createCode, newCode } = await signedIn()
    await newCode()
    await newCode()
    await newCode()
    const fourth = await createCode()
    expect(fourth.status).toBe(409)
    expect(await errorCode(fourth)).toBe('auth/pairing_limit_reached')
    t.clock.advance(5 * 60_000)
    expect((await createCode()).status).toBe(201)
  })

  test('403 profile/restricted from a restricted profile', async () => {
    const { web, createCode } = await signedIn()
    const kid = (await (
      await web.send('POST', '/api/v1/profiles', { name: 'Enfants', maxContentRating: '10' })
    ).json()) as { id: string }
    await web.send('POST', `/api/v1/profiles/${kid.id}/select`, {})
    const refused = await createCode()
    expect(refused.status).toBe(403)
    expect(await errorCode(refused)).toBe('profile/restricted')
  })
})

describe('POST /auth/pairings/claim', () => {
  test('public: trades the code for a bearer token of the account, once', async () => {
    const { t, web, newCode } = await signedIn()
    const pairing = await newCode()
    const response = await claim(t, {
      code: pairing.code.toLowerCase(),
      deviceName: 'iPhone 15 Pro',
    })
    expect(response.status).toBe(200)
    expect(response.headers.get('set-cookie')).toBeNull()
    const { token } = (await response.json()) as { token: string }

    const me = await t.request('/api/v1/auth/me', { headers: { authorization: `Bearer ${token}` } })
    expect(me.status).toBe(200)
    expect(await me.json()).toMatchObject({ account: { username: 'leo' } })

    const { items } = (await (await web.get('/api/v1/auth/sessions')).json()) as {
      items: { id: string; kind: string; deviceName: string; current: boolean }[]
    }
    const device = items.find((item) => item.deviceName === 'iPhone 15 Pro')
    expect(device?.kind).toBe('bearer')
    const creator = items.find((item) => item.current)
    // The dialog of the creating session hears of it.
    expect(t.events).toContainEqual({
      type: 'pairing.claimed',
      payload: {
        pairingId: pairing.id,
        sessionId: creator?.id ?? '',
        deviceSessionId: device?.id ?? '',
        deviceName: 'iPhone 15 Pro',
      },
    })

    const again = await claim(t, { code: pairing.code, deviceName: 'iPad Air' })
    expect(again.status).toBe(410)
    expect(await errorCode(again)).toBe('auth/pairing_used')
  })

  test('unknown code 404, expired code 410, invalid body 400', async () => {
    const { t, newCode } = await signedIn()
    const pairing = await newCode()
    const unknown = await claim(t, { code: 'AAAAAA', deviceName: 'iPhone' })
    expect(unknown.status).toBe(404)
    expect(await errorCode(unknown)).toBe('auth/pairing_invalid')
    expect((await claim(t, { code: pairing.code })).status).toBe(400)

    t.clock.advance(5 * 60_000)
    const expired = await claim(t, { code: pairing.code, deviceName: 'iPhone' })
    expect(expired.status).toBe(410)
    expect(await errorCode(expired)).toBe('auth/pairing_expired')
  })

  test('revoking the session that created the code voids it', async () => {
    const { t, newCode, cookie } = await signedIn()
    const pairing = await newCode()
    // Another browser revokes the one showing the code.
    const other = t.as(sessionCookieOf(await t.login('leo', adminPassword)))
    const { items } = (await (await t.as(cookie).get('/api/v1/auth/sessions')).json()) as {
      items: { id: string; current: boolean }[]
    }
    const creator = items.find((item) => item.current)
    expect((await other.send('DELETE', `/api/v1/auth/sessions/${creator?.id}`)).status).toBe(204)

    const response = await claim(t, { code: pairing.code, deviceName: 'iPhone' })
    expect(response.status).toBe(404)
    expect(await errorCode(response)).toBe('auth/pairing_invalid')
  })

  test('logging out of the browser voids its codes too', async () => {
    const { t, newCode, web } = await signedIn()
    const pairing = await newCode()
    expect((await web.send('POST', '/api/v1/auth/logout')).status).toBe(204)
    expect((await claim(t, { code: pairing.code, deviceName: 'iPhone' })).status).toBe(404)
  })

  test('10 attempts per 15 min per IP: 429 with Retry-After, other IPs unaffected', async () => {
    const { t, newCode } = await signedIn({ trustProxy: true })
    const pairing = await newCode()
    const from = (ip: string) => ({ 'x-forwarded-for': ip })
    for (let attempt = 0; attempt < 10; attempt += 1) {
      expect(
        (await claim(t, { code: 'AAAAAA', deviceName: 'x' }, from('203.0.113.7'))).status,
      ).toBe(404)
    }
    const blocked = await claim(t, { code: pairing.code, deviceName: 'x' }, from('203.0.113.7'))
    expect(blocked.status).toBe(429)
    expect(await errorCode(blocked)).toBe('auth/rate_limited')
    expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0)

    expect(
      (await claim(t, { code: pairing.code, deviceName: 'iPhone' }, from('203.0.113.8'))).status,
    ).toBe(200)
  })

  test('a browser on another site cannot claim (Origin check)', async () => {
    const { t, newCode } = await signedIn()
    const pairing = await newCode()
    const response = await claim(
      t,
      { code: pairing.code, deviceName: 'iPhone' },
      { origin: 'https://evil.example' },
    )
    expect(response.status).toBe(403)
    expect(await errorCode(response)).toBe('auth/origin_mismatch')
  })
})
