import { Hono } from 'hono'

import { setupBodySchema, type SetupStatusResponse } from '@projo/shared/api/setup'

import type { GetMe } from '../../../application/auth/get-me.ts'
import type { OpenSession } from '../../../application/auth/open-session.ts'
import type { CompleteSetup } from '../../../application/setup/complete-setup.ts'
import type { GetSetupStatus } from '../../../application/setup/get-setup-status.ts'
import { describeUserAgent } from '../../../core/auth/user-agent.ts'
import type { Clock } from '../../../core/clock.ts'
import { clientInfo } from '../client-info.ts'
import type { AppEnv } from '../context.ts'
import { respondError } from '../errors.ts'
import { setSessionCookie } from '../session-cookie.ts'
import { validate } from '../validation.ts'
import { toMeResponse } from './auth.ts'

type Deps = {
  getSetupStatus: GetSetupStatus
  completeSetup: CompleteSetup
  openSession: OpenSession
  getMe: GetMe
  clock: Clock
  trustProxy: boolean
}

export const setupRoutes = ({
  getSetupStatus,
  completeSetup,
  openSession,
  getMe,
  clock,
  trustProxy,
}: Deps) =>
  new Hono<AppEnv>()
    .get('/setup/status', (c) => c.json(getSetupStatus() satisfies SetupStatusResponse, 200))
    .post('/setup', validate('json', setupBodySchema), async (c) => {
      const body = c.req.valid('json')
      const result = await completeSetup({
        username: body.username,
        password: body.password,
        serverName: body.serverName,
        metadataLanguage: body.metadataLanguage,
        uiLocale: body.uiLocale,
        ...(body.profile.name === undefined ? {} : { profileName: body.profile.name }),
        ...(body.profile.avatarColor === undefined
          ? {}
          : { avatarColor: body.profile.avatarColor }),
      })
      if (!result.ok) return respondError(c, result.error)

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
        secure: clientInfo(c, { trustProxy }).https,
      })
      const me = getMe({ accountId: account.id, activeProfileId: profile.id })
      return me.ok ? c.json(toMeResponse(me.value), 201) : respondError(c, me.error)
    })

export type SetupRoutes = ReturnType<typeof setupRoutes>
