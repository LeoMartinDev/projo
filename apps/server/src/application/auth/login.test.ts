import { describe, expect, test } from 'bun:test'

import { sampleAccount } from '../../../test/support/auth.ts'
import { createAuthWorld as setup } from '../../../test/support/auth-world.ts'
import { sessionLifetimeMs } from '../../core/auth/session.ts'
import { loginRateLimitKeys } from './login.ts'

const password = 'correct horse battery'

const loginInput = { username: 'leo', password, ip: '10.0.0.1', userAgent: 'Firefox/1 Linux' }

describe('login', () => {
  test('opens a 30-day cookie session, case-insensitive username, remembers the only profile', async () => {
    const t = setup()
    const result = await t.login(loginInput)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.token).toBe('token-1')
    expect(result.value.session).toMatchObject({
      accountId: 'account-1',
      kind: 'cookie',
      tokenHash: 'h(token-1)',
      deviceName: 'Firefox · Linux',
      lastProfileId: 'profile-1',
    })
    expect(result.value.session.expiresAt.getTime() - t.clock.now().getTime()).toBe(
      sessionLifetimeMs,
    )
  })

  test('wrong password and unknown user give the same error and the same hashing work', async () => {
    const t = setup()
    const wrong = await t.login({ ...loginInput, password: 'nope' })
    const unknown = await t.login({ ...loginInput, username: 'ghost' })
    expect(wrong).toMatchObject({ ok: false, error: { code: 'auth/invalid_credentials' } })
    expect(unknown).toMatchObject({ ok: false, error: { code: 'auth/invalid_credentials' } })
    expect(t.calls.verify).toBe(2)
    expect(t.sessions.size).toBe(0)
  })

  test('rate limited after 10 failures per username, whatever the IP', async () => {
    const t = setup()
    for (let i = 0; i < 10; i += 1) {
      await t.login({ ...loginInput, password: 'nope', ip: `10.0.0.${i}` })
    }
    const blocked = await t.login({ ...loginInput, ip: '10.9.9.9' })
    expect(blocked).toMatchObject({
      ok: false,
      error: { code: 'auth/rate_limited', context: { retryAfterSeconds: 60 } },
    })
  })

  test('rate limited after 10 failures per IP, whatever the username', async () => {
    const t = setup()
    for (let i = 0; i < 10; i += 1) {
      await t.login({ ...loginInput, username: `user${i}`, password: 'nope' })
    }
    const blocked = await t.login(loginInput)
    expect(blocked).toMatchObject({ ok: false, error: { code: 'auth/rate_limited' } })
  })

  test('a success clears the username counter', async () => {
    const t = setup()
    await t.login({ ...loginInput, password: 'nope' })
    await t.login(loginInput)
    const keys = loginRateLimitKeys({ ip: loginInput.ip, username: 'LEO' })
    expect(t.rate.hits.get(keys.username)).toBeUndefined()
    expect(t.rate.hits.get(keys.ip)).toBe(2)
  })

  test('parallel attempts cannot overtake the limit while argon2 runs', async () => {
    const t = setup()
    const results = await Promise.all(
      Array.from({ length: 40 }, () => t.login({ ...loginInput, password: 'nope' })),
    )
    const codes = results.map((result) => (result.ok ? 'ok' : result.error.code))
    expect(codes.filter((code) => code === 'auth/invalid_credentials')).toHaveLength(10)
    expect(codes.filter((code) => code === 'auth/rate_limited')).toHaveLength(30)
    expect(t.calls.verify).toBe(10)
  })

  test('a disabled account is refused once the password is proven', async () => {
    const t = setup({ accounts: [sampleAccount({ disabledAt: new Date('2026-01-02T00:00:00Z') })] })
    expect(await t.login(loginInput)).toMatchObject({
      ok: false,
      error: { code: 'auth/account_disabled' },
    })
    expect(await t.login({ ...loginInput, password: 'nope' })).toMatchObject({
      ok: false,
      error: { code: 'auth/invalid_credentials' },
    })
  })
})
