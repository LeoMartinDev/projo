import type { Context } from 'hono'

import { appError, type AppError, err, ok, type Result } from '@projo/shared'

import type { AuthAccount, AuthSession } from '../../core/auth/principal.ts'
import type { AppEnv } from './context.ts'

/**
 * Helpers for routes behind authentication. Every `/api/v1` route that is not public (setup,
 * login, logout, invitations) only runs with an account: `authenticate` answers 401 before.
 */

/** The authenticated account and session. Missing = the route is not behind `authenticate`: a bug. */
export const currentPrincipal = (
  c: Context<AppEnv>,
): { account: AuthAccount; session: AuthSession } => {
  const account = c.get('account')
  const session = c.get('session')
  if (account === undefined || session === undefined) {
    throw new Error(`no authenticated account on ${c.req.method} ${c.req.path}`)
  }
  return { account, session }
}

/**
 * The active profile (`X-Profile-Id`, or the account's only profile). Reading progress and
 * playback need one: `profile/required` (400) tells the client to choose.
 */
export const currentProfileId = (
  c: Context<AppEnv>,
): Result<string, AppError<'profile/required'>> => {
  const profileId = c.get('profileId')
  return profileId === undefined
    ? err(appError('profile/required', 'an active profile is required (X-Profile-Id)'))
    : ok(profileId)
}
