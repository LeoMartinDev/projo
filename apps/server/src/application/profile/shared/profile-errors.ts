import { appError, err } from '@projo/shared'

import { maxProfilesPerAccount } from '../../../core/profile/profile.ts'

export const profileNotFound = (profileId: string) =>
  err(appError('profile/not_found', 'profile not found', { context: { profileId } }))

export const adminOnly = () =>
  err(
    appError(
      'profile/admin_only',
      'only an admin acting from an unrestricted profile may widen library access or rating',
    ),
  )

export const lastUnrestricted = (accountId: string) =>
  err(
    appError(
      'profile/last_unrestricted',
      'an admin account keeps at least one unrestricted profile',
      { context: { accountId } },
    ),
  )

export const limitReached = () =>
  err(
    appError('profile/limit_reached', 'an account has at most 5 profiles', {
      context: { limit: maxProfilesPerAccount },
    }),
  )
