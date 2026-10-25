import { describe, expect, test } from 'bun:test'

import {
  createCountingRateLimiter,
  createFakePasswordHasher,
  createFakeSessionTokens,
  createInMemoryAccounts,
  createInMemoryProfiles,
  createInMemorySessions,
  sampleAccount,
  sampleProfile,
} from '../../../test/support/auth.ts'
import { createManualClock } from '../../../test/support/clock.ts'
import { createSequentialIds } from '../../../test/support/fakes.ts'
import { silentLogger } from '../../../test/support/logger.ts'
import { sessionLifetimeMs } from '../../core/auth/session.ts'
import { authenticateFactory } from './authenticate.ts'
import { getMeFactory } from './get-me.ts'
import { loginFactory, loginRateLimitKeys } from './login.ts'
import { openSessionFactory } from './open-session.ts'
import { resolveProfileFactory } from './resolve-profile.ts'
import { listSessionsFactory, revokeSessionFactory } from './sessions.ts'

const password = 'correct horse battery'

const setup = ({
  accounts = [sampleAccount()],
  profiles = [sampleProfile()],
}: {
  accounts?: ReturnType<typeof sampleAccount>[]
  profiles?: ReturnType<typeof sampleProfile>[]
} = {}) => {
  const clock = createManualClock()
  const accountRepository = createInMemoryAccounts(accounts).repository
  const profileRepository = createInMemoryProfiles(profiles).repository
  const sessionStore = createInMemorySessions()
  const sessionRepository = sessionStore.repository
  const sessionTokens = createFakeSessionTokens()
  const { hasher, calls } = createFakePasswordHasher()
  const rate = createCountingRateLimiter(10)
  const openSession = openSessionFactory({
    sessionRepository,
    sessionTokens,
    clock,
    ids: createSequentialIds('session-'),
  })
  return {
    clock,
    calls,
    rate,
    sessions: sessionStore.sessions,
    sessionRepository,
    openSession,
    login: loginFactory({
      accountRepository,
      profileRepository,
      passwordHasher: hasher,
      rateLimiter: rate.limiter,
      openSession,
      logger: silentLogger,
    }),
    authenticate: authenticateFactory({
      accountRepository,
      sessionRepository,
      sessionTokens,
      clock,
    }),
    resolveProfile: resolveProfileFactory({ profileRepository, sessionRepository }),
    getMe: getMeFactory({ accountRepository, profileRepository }),
    listSessions: listSessionsFactory({ sessionRepository, clock }),
    revokeSession: revokeSessionFactory({ sessionRepository, clock, logger: silentLogger }),
  }
}

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
    // §20 counts attempts per IP, successes included.
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

describe('authenticate', () => {
  test('resolves a token of the right kind only', () => {
    const t = setup()
    const { token } = t.openSession({
      accountId: 'account-1',
      kind: 'cookie',
      deviceName: 'd',
      userAgent: '',
    })
    expect(t.authenticate({ token, kind: 'cookie' })).toMatchObject({
      ok: true,
      value: { account: { id: 'account-1', username: 'Leo', role: 'admin' }, renewed: false },
    })
    expect(t.authenticate({ token, kind: 'bearer' })).toMatchObject({
      ok: false,
      error: { code: 'auth/unauthenticated' },
    })
    expect(t.authenticate({ token: 'forged', kind: 'cookie' })).toMatchObject({
      ok: false,
      error: { code: 'auth/unauthenticated' },
    })
  })

  test('slides the expiry after 24 h, expires after 30 idle days', () => {
    const t = setup()
    const { token, session } = t.openSession({
      accountId: 'account-1',
      kind: 'cookie',
      deviceName: 'd',
      userAgent: '',
    })
    t.clock.advance(25 * 3_600_000)
    const renewed = t.authenticate({ token, kind: 'cookie' })
    expect(renewed).toMatchObject({ ok: true, value: { renewed: true } })
    expect(t.sessions.get(session.id)?.expiresAt).toEqual(
      new Date(t.clock.now().getTime() + sessionLifetimeMs),
    )

    t.clock.advance(sessionLifetimeMs)
    expect(t.authenticate({ token, kind: 'cookie' })).toMatchObject({
      ok: false,
      error: { code: 'auth/session_expired' },
    })
  })

  test('revoked sessions and disabled accounts are refused', () => {
    const t = setup()
    const { token, session } = t.openSession({
      accountId: 'account-1',
      kind: 'bearer',
      deviceName: 'd',
      userAgent: '',
    })
    t.sessionRepository.revoke({ id: session.id, revokedAt: t.clock.now() })
    expect(t.authenticate({ token, kind: 'bearer' })).toMatchObject({
      ok: false,
      error: { code: 'auth/session_revoked' },
    })

    const disabled = setup({ accounts: [sampleAccount({ disabledAt: new Date(0) })] })
    const opened = disabled.openSession({
      accountId: 'account-1',
      kind: 'cookie',
      deviceName: 'd',
      userAgent: '',
    })
    expect(disabled.authenticate({ token: opened.token, kind: 'cookie' })).toMatchObject({
      ok: false,
      error: { code: 'auth/account_disabled' },
    })
  })
})

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
    // Unlocked (POST /profiles/:id/select made it the last profile).
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

describe('sessions', () => {
  test('lists active sessions of the account and revokes only its own', () => {
    const t = setup()
    const mine = t.openSession({
      accountId: 'account-1',
      kind: 'cookie',
      deviceName: 'a',
      userAgent: '',
    })
    const other = t.openSession({
      accountId: 'account-2',
      kind: 'cookie',
      deviceName: 'b',
      userAgent: '',
    })
    expect(t.listSessions({ accountId: 'account-1' }).map((s) => s.id)).toEqual([mine.session.id])

    expect(t.revokeSession({ accountId: 'account-1', sessionId: other.session.id })).toMatchObject({
      ok: false,
      error: { code: 'auth/session_not_found' },
    })
    expect(t.revokeSession({ accountId: 'account-1', sessionId: mine.session.id }).ok).toBe(true)
    expect(t.listSessions({ accountId: 'account-1' })).toEqual([])
  })
})

describe('getMe', () => {
  test('account and its profiles', () => {
    const t = setup()
    expect(t.getMe({ accountId: 'account-1', activeProfileId: 'profile-1' })).toMatchObject({
      ok: true,
      value: {
        account: { id: 'account-1', username: 'Leo', role: 'admin' },
        profiles: [{ id: 'profile-1' }],
        activeProfileId: 'profile-1',
        needsProfileSelection: false,
      },
    })
  })

  test('"Qui regarde ?" when no profile of the account is active', () => {
    const t = setup({ profiles: [sampleProfile(), sampleProfile({ id: 'profile-2' })] })
    const me = t.getMe({ accountId: 'account-1', activeProfileId: undefined })
    expect(me).toMatchObject({ ok: true, value: { needsProfileSelection: true } })
    expect(me.ok && me.value.activeProfileId).toBeUndefined()
  })
})
