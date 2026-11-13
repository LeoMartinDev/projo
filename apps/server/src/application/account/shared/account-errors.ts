import { appError, type AppError, err } from '@projo/shared'

export type AccountNotFound = AppError<'account/not_found'>

export const accountNotFound = (accountId: string) =>
  err(appError('account/not_found', 'account not found', { context: { accountId } }))

export const lastAdmin = (accountId: string) =>
  err(
    appError(
      'account/last_admin',
      'the last enabled admin cannot be demoted, disabled or deleted',
      {
        context: { accountId },
      },
    ),
  )
