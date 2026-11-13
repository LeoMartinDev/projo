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

import type { CreateAccount } from '../../../application/account/create-account.ts'
import type { DeleteAccount } from '../../../application/account/delete-account.ts'
import type { ListAccounts } from '../../../application/account/list-accounts.ts'
import type { ResetAccountPassword } from '../../../application/account/reset-account-password.ts'
import type { RevokeAccountSessions } from '../../../application/account/revoke-account-sessions.ts'
import type { AdminAccountView } from '../../../application/account/shared/admin-account-view.ts'
import type { UpdateAccount } from '../../../application/account/update-account.ts'
import type { CreateInvitation } from '../../../application/invitation/create-invitation.ts'
import type { DeleteInvitation } from '../../../application/invitation/delete-invitation.ts'
import type { ListInvitations } from '../../../application/invitation/list-invitations.ts'
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
  listAccounts: ListAccounts
  createAccount: CreateAccount
  updateAccount: UpdateAccount
  deleteAccount: DeleteAccount
  resetAccountPassword: ResetAccountPassword
  revokeAccountSessions: RevokeAccountSessions
  listInvitations: ListInvitations
  createInvitation: CreateInvitation
  deleteInvitation: DeleteInvitation
  clock: Clock
}

export const adminAccountsRoutes = ({
  listAccounts,
  createAccount,
  updateAccount,
  deleteAccount,
  resetAccountPassword,
  revokeAccountSessions,
  listInvitations,
  createInvitation,
  deleteInvitation,
  clock,
}: Deps) =>
  new Hono<AppEnv>()
    .get('/accounts', (c) =>
      c.json({ items: listAccounts().map(toAdminAccountDto) } satisfies AdminAccountsResponse, 200),
    )
    .post('/accounts', validate('json', createAccountBodySchema), async (c) => {
      const body = c.req.valid('json')
      const result = await createAccount({
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
      const result = updateAccount({
        accountId: c.req.param('id'),
        ...(role === undefined ? {} : { role }),
        ...(disabled === undefined ? {} : { disabled }),
      })
      return result.ok
        ? c.json(toAdminAccountDto(result.value), 200)
        : respondError(c, result.error)
    })
    .delete('/accounts/:id', validate('json', deleteAccountBodySchema), (c) => {
      const result = deleteAccount({
        accountId: c.req.param('id'),
        confirmUsername: c.req.valid('json').confirmUsername,
      })
      return result.ok ? noContent(c) : respondError(c, result.error)
    })
    .post('/accounts/:id/reset-password', validate('json', resetPasswordBodySchema), async (c) => {
      const result = await resetAccountPassword({
        accountId: c.req.param('id'),
        password: c.req.valid('json').password,
      })
      return result.ok ? noContent(c) : respondError(c, result.error)
    })
    .post('/accounts/:id/revoke-sessions', (c) => {
      const result = revokeAccountSessions({ accountId: c.req.param('id') })
      return result.ok ? noContent(c) : respondError(c, result.error)
    })
    .get('/invitations', (c) => {
      const now = clock.now()
      return c.json(
        {
          items: listInvitations().map((invitation) => toInvitationDto(invitation, now)),
        } satisfies InvitationsResponse,
        200,
      )
    })
    .post('/invitations', (c) => {
      const { account } = currentPrincipal(c)
      const { invitation, token } = createInvitation({ createdBy: account.id })
      return c.json(
        {
          invitation: toInvitationDto(invitation, clock.now()),
          token,
        } satisfies CreateInvitationResponse,
        201,
      )
    })
    .delete('/invitations/:id', (c) => {
      const result = deleteInvitation({ id: c.req.param('id') })
      return result.ok ? noContent(c) : respondError(c, result.error)
    })

export type AdminAccountsRoutes = ReturnType<typeof adminAccountsRoutes>
