import type { Context, MiddlewareHandler } from 'hono'

import { appError, type AppError, type Result } from '@projo/shared'
import { profileIdHeader } from '@projo/shared/api/auth'

import type { Authenticate, AuthenticateError } from '../../application/auth/authenticate.ts'
import type { ResolveProfile } from '../../application/auth/resolve-profile.ts'
import { toAuthSession } from '../../core/auth/session.ts'
import type { Clock } from '../../core/clock.ts'
import type { ApiMiddleware } from './api.ts'
import { clientInfo } from './client-info.ts'
import type { AppEnv } from './context.ts'
import { respondError } from './errors.ts'
import { clearSessionCookie, readSessionCredential, setSessionCookie } from './session-cookie.ts'

const apiPrefix = '/api/v1'

/** Routes reachable without an account (§17.2): wizard, login, logout, invitations. */
const publicRoutes: { method: string; path: RegExp }[] = [
  { method: 'GET', path: /^\/setup\/status$/ },
  { method: 'POST', path: /^\/setup$/ },
  { method: 'POST', path: /^\/auth\/login$/ },
  { method: 'POST', path: /^\/auth\/logout$/ },
  { method: 'GET', path: /^\/invitations\/[^/]+$/ },
  { method: 'POST', path: /^\/invitations\/[^/]+\/accept$/ },
]

const apiPath = (c: Context): string =>
  c.req.path.startsWith(`${apiPrefix}/`) ? c.req.path.slice(apiPrefix.length) : c.req.path

const isPublic = (c: Context): boolean => {
  const path = apiPath(c)
  return publicRoutes.some((route) => route.method === c.req.method && route.path.test(path))
}

/**
 * Routes that work without an active profile: an `X-Profile-Id` they cannot honour (foreign, or
 * PIN-locked for this session) leaves `profileId` unset instead of failing, so `GET /auth/me`
 * reports `needsProfileSelection` and `POST /profiles/:id/select` can unlock a profile.
 */
const isProfileAgnostic = (c: Context): boolean => /^\/(auth|profiles)(\/|$)/.test(apiPath(c))

const mutatingMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

/**
 * §20 "check of the `Origin` header on every mutating request". Browsers send `Origin` on
 * every cross-origin and same-origin mutating fetch; when it is absent (native clients), a
 * `Sec-Fetch-Site: cross-site` still betrays a cross-site browser request. `Origin: null` (WebKit's
 * `sendBeacon` under some referrer policies, but also sandboxed or opaque documents) passes only
 * with `Sec-Fetch-Site: same-origin`, which a page cannot set.
 */
const originAllowed = (c: Context, expectedOrigin: string): boolean => {
  if (!mutatingMethods.has(c.req.method)) return true
  const origin = c.req.header('origin')
  const site = c.req.header('sec-fetch-site')
  if (origin === 'null') return site === 'same-origin'
  if (origin !== undefined) return origin === expectedOrigin
  return site !== 'cross-site'
}

type Deps = {
  authenticate: Authenticate
  resolveProfile: ResolveProfile
  /** The profile has library or rating restrictions (§14): no administration from it. */
  isRestrictedProfile: (profileId: string) => boolean
  /** §14: account actions are refused to a restricted profile (`profile/restricted`). */
  ensureAccountActions: (actor: {
    accountId: string
    activeProfileId: string | undefined
  }) => Result<void, AppError>
  clock: Clock
  trustProxy: boolean
}

/**
 * `authenticate`: Origin check on mutating requests, then cookie / bearer → `account`,
 * `session`, `profileId`. Closed by default: a non-public route without a valid session gets 401
 * (`auth/unauthenticated`, `auth/session_expired`, `auth/session_revoked`) or 403
 * (`auth/account_disabled`). A foreign `X-Profile-Id` gets 403 `profile/forbidden`, a PIN-locked
 * one not unlocked by this session 403 `profile/pin_required` (except on `/auth/*`, `/profiles*`).
 *
 * `requireAdmin` (on `/admin/*`): 401 without account, 403 `auth/forbidden` without the role,
 * 403 `auth/restricted_profile` without an active profile, or from a restricted one (a child using
 * the admin's account).
 */
export const createAuthMiddleware = ({
  authenticate,
  resolveProfile,
  isRestrictedProfile,
  ensureAccountActions,
  clock,
  trustProxy,
}: Deps): ApiMiddleware & { requireAccountActions: MiddlewareHandler<AppEnv> } => {
  const authenticateMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
    const client = clientInfo(c, { trustProxy })
    if (!originAllowed(c, client.origin)) {
      return respondError(
        c,
        appError('auth/origin_mismatch', 'request origin not allowed', {
          context: { origin: c.req.header('origin'), expected: client.origin },
        }),
      )
    }

    const open = isPublic(c)
    let failure: AuthenticateError = appError('auth/unauthenticated', 'authentication required')
    const credential = readSessionCredential(c)
    if (credential !== undefined) {
      const authenticated = authenticate(credential)
      if (authenticated.ok) {
        const { account, session, renewed } = authenticated.value
        const profile = resolveProfile({
          session,
          requestedProfileId: c.req.header(profileIdHeader) || undefined,
        })
        if (!profile.ok && !open && !isProfileAgnostic(c)) return respondError(c, profile.error)
        c.set('account', account)
        c.set('session', toAuthSession(session))
        c.set('profileId', profile.ok ? profile.value : undefined)
        c.set('logger', c.get('logger').child({ sessionId: session.id }))
        if (renewed && credential.kind === 'cookie') {
          setSessionCookie(c, {
            token: credential.token,
            expiresAt: session.expiresAt,
            now: clock.now(),
            secure: client.https,
          })
        }
      } else {
        failure = authenticated.error
        if (credential.kind === 'cookie') clearSessionCookie(c, { secure: client.https })
      }
    }

    if (c.get('account') === undefined && !open) return respondError(c, failure)
    await next()
    return undefined
  }

  const requireAdmin: MiddlewareHandler<AppEnv> = async (c, next) => {
    const account = c.get('account')
    if (account === undefined) {
      return respondError(c, appError('auth/unauthenticated', 'authentication required'))
    }
    if (account.role !== 'admin') {
      return respondError(c, appError('auth/forbidden', 'admin role required'))
    }
    // An active profile, resolved and unrestricted: none resolved is refused too (a refused
    // `X-Profile-Id` must not pass for an unrestricted profile).
    const profileId = c.get('profileId')
    if (profileId === undefined || isRestrictedProfile(profileId)) {
      return respondError(
        c,
        appError(
          'auth/restricted_profile',
          'administration requires an active unrestricted profile',
          { context: profileId === undefined ? {} : { profileId } },
        ),
      )
    }
    await next()
    return undefined
  }

  /**
   * Account actions (§14: devices, bearer tokens, password): refused from a restricted profile,
   * or without a resolved one on an account that has restricted profiles.
   */
  const requireAccountActions: MiddlewareHandler<AppEnv> = async (c, next) => {
    const account = c.get('account')
    if (account === undefined) {
      return respondError(c, appError('auth/unauthenticated', 'authentication required'))
    }
    const allowed = ensureAccountActions({
      accountId: account.id,
      activeProfileId: c.get('profileId'),
    })
    if (!allowed.ok) return respondError(c, allowed.error)
    await next()
    return undefined
  }

  return { authenticate: authenticateMiddleware, requireAdmin, requireAccountActions }
}
