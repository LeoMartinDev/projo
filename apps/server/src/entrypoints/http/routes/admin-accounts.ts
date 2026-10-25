import { Hono } from 'hono'

import {
  type AdminAccountDto,
  type AdminAccountsResponse,
  createAccountBodySchema,
  deleteAccountBodySchema,
  resetPasswordBodySchema,
  updateAccountBodySchema,
} from '@projo/shared/api/accounts'
import type { CreateInvitationResponse, InvitationsResponse } from '@projo/shared/api/invitations'

import type {
  AdminAccounts,
  AdminAccountView,
} from '../../../application/account/admin-accounts.ts'
import type { Invitations } from '../../../application/invitation/invitations.ts'
import type { Clock } from '../../../core/clock.ts'
import type { AppEnv } from '../context.ts'
import { respondError } from '../errors.ts'
import { currentPrincipal } from '../principal.ts'
import { noContent } from '../responses.ts'
import { validate } from '../validation.ts'
import { toProfileDto } from './auth.ts'
import { toInvitationDto } from './invitations.ts'

export const toAdminAccountDto = ({
  account,
  profiles,
  activity,
}: AdminAccountView): AdminAccountDto => ({
  id: account.id,
  username: account.username,
  role: account.role,
  createdAt: account.createdAt.toISOString(),
  ...(account.disabledAt === undefined ? {} : { disabledAt: account.disabledAt.toISOString() }),
  ...(activity.lastSeenAt === undefined ? {} : { lastSeenAt: activity.lastSeenAt.toISOString() }),
  ...(activity.lastDeviceName === undefined ? {} : { lastDeviceName: activity.lastDeviceName }),
  activeSessions: activity.activeSessions,
  playing: activity.playingProfileIds.length > 0,
  profiles: profiles.map((profile) => ({
    ...toProfileDto(profile),
    playing: activity.playingProfileIds.includes(profile.id),
  })),
})

type Deps = {
  accounts: AdminAccounts
  invitations: Invitations
  clock: Clock
}

/**
 * §17.2 Admin comptes: `/admin/accounts…` and `/admin/invitations…` (§15 Accounts).
 * Mounted at `/api/v1/admin` (behind `requireAdmin`). Middleware: per route or path-scoped,
 * never `.use('*')`.
 */
export const adminAccountsRoutes = ({ accounts, invitations, clock }: Deps) =>
  new Hono<AppEnv>()
    .get('/accounts', (c) =>
      c.json(
        { items: accounts.list().map(toAdminAccountDto) } satisfies AdminAccountsResponse,
        200,
      ),
    )
    .post('/accounts', validate('json', createAccountBodySchema), async (c) => {
      const body = c.req.valid('json')
      const result = await accounts.create({
        username: body.username,
        password: body.password,
        role: body.role,
        uiLocale: body.uiLocale,
        ...(body.profile.name === undefined ? {} : { profileName: body.profile.name }),
        ...(body.profile.avatarColor === undefined
          ? {}
          : { avatarColor: body.profile.avatarColor }),
      })
      return result.ok
        ? c.json(toAdminAccountDto(result.value), 201)
        : respondError(c, result.error)
    })
    .patch('/accounts/:id', validate('json', updateAccountBodySchema), (c) => {
      const { role, disabled } = c.req.valid('json')
      const result = accounts.update({
        accountId: c.req.param('id'),
        ...(role === undefined ? {} : { role }),
        ...(disabled === undefined ? {} : { disabled }),
      })
      return result.ok
        ? c.json(toAdminAccountDto(result.value), 200)
        : respondError(c, result.error)
    })
    .delete('/accounts/:id', validate('json', deleteAccountBodySchema), (c) => {
      const result = accounts.delete({
        accountId: c.req.param('id'),
        confirmUsername: c.req.valid('json').confirmUsername,
      })
      return result.ok ? noContent(c) : respondError(c, result.error)
    })
    .post('/accounts/:id/reset-password', validate('json', resetPasswordBodySchema), async (c) => {
      const result = await accounts.resetPassword({
        accountId: c.req.param('id'),
        password: c.req.valid('json').password,
      })
      return result.ok ? noContent(c) : respondError(c, result.error)
    })
    .post('/accounts/:id/revoke-sessions', (c) => {
      const result = accounts.revokeSessions({ accountId: c.req.param('id') })
      return result.ok ? noContent(c) : respondError(c, result.error)
    })
    .get('/invitations', (c) => {
      const now = clock.now()
      return c.json(
        {
          items: invitations.list().map((invitation) => toInvitationDto(invitation, now)),
        } satisfies InvitationsResponse,
        200,
      )
    })
    .post('/invitations', (c) => {
      const { account } = currentPrincipal(c)
      const { invitation, token } = invitations.create({ createdBy: account.id })
      return c.json(
        {
          invitation: toInvitationDto(invitation, clock.now()),
          token,
        } satisfies CreateInvitationResponse,
        201,
      )
    })
    .delete('/invitations/:id', (c) => {
      const result = invitations.delete({ id: c.req.param('id') })
      return result.ok ? noContent(c) : respondError(c, result.error)
    })

export type AdminAccountsRoutes = ReturnType<typeof adminAccountsRoutes>
