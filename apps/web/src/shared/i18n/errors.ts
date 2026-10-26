import { useTranslation } from 'react-i18next'

import { type ErrorKey, errorKeyOf } from '@projo/i18n/errors'

import { type ApiFailure, toApiFailure } from '../api/failure.ts'

export const errorKey = (failure: unknown): ErrorKey => errorKeyOf(toApiFailure(failure).code)

/** `(failure) => translated message`, for error states and form alerts. */
export const useErrorMessage = (): ((failure: ApiFailure | unknown) => string) => {
  const { t } = useTranslation()
  return (failure) => t(errorKey(failure))
}
