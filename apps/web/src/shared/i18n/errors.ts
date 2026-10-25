import { useTranslation } from 'react-i18next'

import { type ApiFailure, type FailureCode, toApiFailure } from '../api/failure.ts'

/**
 * Every API error code has a translation under `errors.<domain/reason>` (§19 "API error codes are
 * translated on the web"); `errors.network` and `errors.unknown` cover the rest.
 * `errors.test.ts` checks that no code is missing in any locale.
 */
export type ErrorKey = `errors.${FailureCode}`

export const errorKey = (failure: unknown): ErrorKey => `errors.${toApiFailure(failure).code}`

/** `(failure) => translated message`, for error states and form alerts. */
export const useErrorMessage = (): ((failure: ApiFailure | unknown) => string) => {
  const { t } = useTranslation()
  return (failure) => t(errorKey(failure))
}
