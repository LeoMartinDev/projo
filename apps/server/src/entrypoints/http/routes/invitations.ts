import { Hono } from 'hono'

import {
  acceptInvitationBodySchema,
  type InvitationDto,
  type InvitationStatusResponse,
} from '@projo/shared/api/invitations'

import type { GetMe } from '../../../application/auth/get-me.ts'
import type { OpenSession } from '../../../application/auth/open-session.ts'
import type { Invitations } from '../../../application/invitation/invitations.ts'
import { describeUserAgent } from '../../../core/auth/user-agent.ts'
import type { Clock } from '../../../core/clock.ts'
import { type InvitationListing, invitationState } from '../../../core/invitation/invitation.ts'
import { clientInfo } from '../client-info.ts'
import type { AppEnv } from '../context.ts'
import { respondError } from '../errors.ts'
import { setSessionCookie } from '../session-cookie.ts'
import { validate } from '../validation.ts'
import { respondErrorWithRetry, toMeResponse } from './auth.ts'

export const toInvitationDto = (invitation: InvitationListing, now: Date): InvitationDto => ({
  id: invitation.id,
  ...(invitation.createdBy === undefined || invitation.createdByUsername === undefined
    ? {}
    : { createdBy: { id: invitation.createdBy, username: invitation.createdByUsername } }),
  expiresAt: invitation.expiresAt.toISOString(),
  state: invitationState(invitation, now),
  ...(invitation.usedAt === undefined ? {} : { usedAt: invitation.usedAt.toISOString() }),
  ...(invitation.usedByAccountId === undefined || invitation.usedByUsername === undefined
    ? {}
    : { usedBy: { id: invitation.usedByAccountId, username: invitation.usedByUsername } }),
})

type Deps = {
  invitations: Invitations
  openSession: OpenSession
  getMe: GetMe
  serverName: () => string | undefined
  clock: Clock
  trustProxy: boolean
}

/**
 * §17.2 Auth, public side of invitations (§14): `GET /invitations/:token`,
 * `POST /invitations/:token/accept` (both public, see `authenticate`). The admin side lives in
 * `admin-accounts.ts`.
 * Mounted at `/api/v1`. Middleware: per route or path-scoped, never `.use('*')`.
 */
export const invitationsRoutes = ({
  invitations,
  openSession,
  getMe,
  serverName,
  clock,
  trustProxy,
}: Deps) =>
  new Hono<AppEnv>()
    .get('/invitations/:token', (c) => {
      const result = invitations.check({ token: c.req.param('token') })
      if (!result.ok) return respondError(c, result.error)
      const name = serverName()
      return c.json(
        {
          expiresAt: result.value.expiresAt.toISOString(),
          ...(name === undefined ? {} : { serverName: name }),
        } satisfies InvitationStatusResponse,
        200,
      )
    })
    .post('/invitations/:token/accept', validate('json', acceptInvitationBodySchema), async (c) => {
      const client = clientInfo(c, { trustProxy })
      const body = c.req.valid('json')
      const result = await invitations.accept({
        token: c.req.param('token'),
        ip: client.ip,
        username: body.username,
        password: body.password,
        uiLocale: body.uiLocale,
        ...(body.profile.name === undefined ? {} : { profileName: body.profile.name }),
        ...(body.profile.avatarColor === undefined
          ? {}
          : { avatarColor: body.profile.avatarColor }),
      })
      if (!result.ok) return respondErrorWithRetry(c, result.error)

      // Signed in right away, on the new account's first profile (§4 parcours 2).
      const { account, profile } = result.value
      const userAgent = c.req.header('user-agent') ?? ''
      const { token, session } = openSession({
        accountId: account.id,
        kind: 'cookie',
        deviceName: describeUserAgent(userAgent),
        userAgent,
        lastProfileId: profile.id,
      })
      setSessionCookie(c, {
        token,
        expiresAt: session.expiresAt,
        now: clock.now(),
        secure: client.https,
      })
      const me = getMe({ accountId: account.id, activeProfileId: profile.id })
      return me.ok ? c.json(toMeResponse(me.value), 201) : respondError(c, me.error)
    })

export type InvitationsRoutes = ReturnType<typeof invitationsRoutes>
