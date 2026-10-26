import { type Context, Hono, type MiddlewareHandler } from 'hono'

import type { AppError } from '@projo/shared'

import {
  changePasswordBodySchema,
  claimPairingBodySchema,
  type ClaimPairingResponse,
  type CreatePairingResponse,
  createTokenBodySchema,
  type CreateTokenResponse,
  loginBodySchema,
  type LoginResponse,
  type MeResponse,
  type ProfileDto,
  type SessionDto,
  type SessionsResponse,
} from '@projo/shared/api/auth'

import type { ChangePassword } from '../../../application/auth/change-password.ts'
import type { GetMe, Me } from '../../../application/auth/get-me.ts'
import type { Login } from '../../../application/auth/login.ts'
import type { OpenSession } from '../../../application/auth/open-session.ts'
import type { Pairings } from '../../../application/auth/pairings.ts'
import type { ListSessions, RevokeSession } from '../../../application/auth/sessions.ts'
import type { Session } from '../../../core/auth/session.ts'
import type { Clock } from '../../../core/clock.ts'
import type { Profile } from '../../../core/profile/profile.ts'
import { clientInfo } from '../client-info.ts'
import type { AppEnv } from '../context.ts'
import { respondError } from '../errors.ts'
import { currentPrincipal } from '../principal.ts'
import { noContent } from '../responses.ts'
import { clearSessionCookie, setSessionCookie } from '../session-cookie.ts'
import { validate } from '../validation.ts'

export const toProfileDto = (profile: Profile): ProfileDto => ({
  id: profile.id,
  name: profile.name,
  avatarColor: profile.avatarColor,
  hasPin: profile.pinHash !== undefined,
  uiLocale: profile.uiLocale,
  audioLanguage: profile.audioLanguage,
  subtitleLanguage: profile.subtitleLanguage,
  subtitleMode: profile.subtitleMode,
  animeOriginalAudio: profile.animeOriginalAudio,
  autoplayNext: profile.autoplayNext,
  autoSkipIntro: profile.autoSkipIntro,
  autoSkipCredits: profile.autoSkipCredits,
  libraryAccess: profile.libraryAccess,
  libraryIds: profile.libraryIds,
  ...(profile.maxContentRating === undefined ? {} : { maxContentRating: profile.maxContentRating }),
  createdAt: profile.createdAt.toISOString(),
})

export const toMeResponse = ({
  account,
  profiles,
  activeProfileId,
  needsProfileSelection,
}: Me): MeResponse => ({
  account: { id: account.id, username: account.username, role: account.role },
  profiles: profiles.map(toProfileDto),
  ...(activeProfileId === undefined ? {} : { activeProfileId }),
  needsProfileSelection,
})

/** `respondError`, with `Retry-After` when the error carries `retryAfterSeconds` (429). */
export const respondErrorWithRetry = (c: Context<AppEnv>, error: AppError) => {
  const retryAfter = error.context?.['retryAfterSeconds']
  if (typeof retryAfter === 'number') c.header('Retry-After', String(retryAfter))
  return respondError(c, error)
}

const toSessionDto = (session: Session, currentSessionId: string | undefined): SessionDto => ({
  id: session.id,
  kind: session.kind,
  deviceName: session.deviceName,
  userAgent: session.userAgent,
  createdAt: session.createdAt.toISOString(),
  lastSeenAt: session.lastSeenAt.toISOString(),
  expiresAt: session.expiresAt.toISOString(),
  current: session.id === currentSessionId,
})

type Deps = {
  login: Login
  changePassword: ChangePassword
  getMe: GetMe
  openSession: OpenSession
  listSessions: ListSessions
  revokeSession: RevokeSession
  pairings: Pairings
  /** §14: devices, tokens, pairing and password are refused to a restricted profile. */
  requireAccountActions: MiddlewareHandler<AppEnv>
  clock: Clock
  trustProxy: boolean
}

/**
 * §17.2 Auth: `/auth/*` (invitations: `invitations.ts`).
 * Mounted at `/api/v1`. Middleware: per route or path-scoped, never `.use('*')` (the sub-app is
 * mounted at a shared prefix, a wildcard would leak to every other domain).
 */
export const authRoutes = ({
  login,
  changePassword,
  getMe,
  openSession,
  listSessions,
  revokeSession,
  pairings,
  requireAccountActions,
  clock,
  trustProxy,
}: Deps) =>
  new Hono<AppEnv>()
    .post('/auth/login', validate('json', loginBodySchema), async (c) => {
      const client = clientInfo(c, { trustProxy })
      const { username, password, deviceName, token: wantsToken } = c.req.valid('json')
      const result = await login({
        username,
        password,
        ip: client.ip,
        userAgent: c.req.header('user-agent') ?? '',
        kind: wantsToken === true ? 'bearer' : 'cookie',
        ...(deviceName === undefined ? {} : { deviceName }),
      })
      if (!result.ok) return respondErrorWithRetry(c, result.error)
      const { token, session } = result.value
      if (session.kind === 'cookie') {
        // Logging in again on the same browser replaces its previous cookie session.
        const previous = c.get('session')
        if (previous?.kind === 'cookie') {
          revokeSession({ accountId: previous.accountId, sessionId: previous.id })
        }
        setSessionCookie(c, {
          token,
          expiresAt: session.expiresAt,
          now: clock.now(),
          secure: client.https,
        })
      }
      const me = getMe({ accountId: session.accountId, activeProfileId: session.lastProfileId })
      if (!me.ok) return respondError(c, me.error)
      return c.json(
        {
          ...toMeResponse(me.value),
          ...(session.kind === 'bearer' ? { token } : {}),
        } satisfies LoginResponse,
        200,
      )
    })
    .post('/auth/logout', (c) => {
      const session = c.get('session')
      if (session !== undefined)
        revokeSession({ accountId: session.accountId, sessionId: session.id })
      if (session === undefined || session.kind === 'cookie') {
        clearSessionCookie(c, { secure: clientInfo(c, { trustProxy }).https })
      }
      return noContent(c)
    })
    .get('/auth/me', (c) => {
      const { account } = currentPrincipal(c)
      const me = getMe({ accountId: account.id, activeProfileId: c.get('profileId') })
      return me.ok ? c.json(toMeResponse(me.value), 200) : respondError(c, me.error)
    })
    .post('/auth/tokens', requireAccountActions, validate('json', createTokenBodySchema), (c) => {
      const { account } = currentPrincipal(c)
      const { token, session } = openSession({
        accountId: account.id,
        kind: 'bearer',
        deviceName: c.req.valid('json').deviceName,
        userAgent: c.req.header('user-agent') ?? '',
      })
      return c.json(
        { token, session: toSessionDto(session, undefined) } satisfies CreateTokenResponse,
        201,
      )
    })
    .post('/auth/pairings', requireAccountActions, (c) => {
      const { account, session } = currentPrincipal(c)
      const result = pairings.create({ accountId: account.id, sessionId: session.id })
      if (!result.ok) return respondError(c, result.error)
      const { pairing, code } = result.value
      return c.json(
        {
          id: pairing.id,
          code,
          expiresAt: pairing.expiresAt.toISOString(),
        } satisfies CreatePairingResponse,
        201,
      )
    })
    .post('/auth/pairings/claim', validate('json', claimPairingBodySchema), (c) => {
      const { code, deviceName } = c.req.valid('json')
      const result = pairings.claim({
        code,
        deviceName,
        ip: clientInfo(c, { trustProxy }).ip,
        userAgent: c.req.header('user-agent') ?? '',
      })
      return result.ok
        ? c.json({ token: result.value.token } satisfies ClaimPairingResponse, 200)
        : respondErrorWithRetry(c, result.error)
    })
    .get('/auth/sessions', (c) => {
      const { account, session: current } = currentPrincipal(c)
      return c.json(
        {
          items: listSessions({ accountId: account.id }).map((session) =>
            toSessionDto(session, current.id),
          ),
        } satisfies SessionsResponse,
        200,
      )
    })
    .delete('/auth/sessions/:id', requireAccountActions, (c) => {
      const { account, session: current } = currentPrincipal(c)
      const sessionId = c.req.param('id')
      const result = revokeSession({ accountId: account.id, sessionId })
      if (!result.ok) return respondError(c, result.error)
      if (sessionId === current.id && current.kind === 'cookie') {
        clearSessionCookie(c, { secure: clientInfo(c, { trustProxy }).https })
      }
      return noContent(c)
    })
    .post(
      '/auth/password',
      requireAccountActions,
      validate('json', changePasswordBodySchema),
      async (c) => {
        const { account, session } = currentPrincipal(c)
        const { currentPassword, newPassword } = c.req.valid('json')
        const result = await changePassword({
          accountId: account.id,
          sessionId: session.id,
          currentPassword,
          newPassword,
        })
        return result.ok ? noContent(c) : respondErrorWithRetry(c, result.error)
      },
    )

export type AuthRoutes = ReturnType<typeof authRoutes>
