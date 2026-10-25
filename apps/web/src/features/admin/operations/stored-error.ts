import { useTranslation } from 'react-i18next'

import { isErrorCode } from '@projo/shared/errors'

/**
 * A stored error (a job's, a notification's): the web's message for a known code, else the
 * server's message (a code from another version).
 */
export const useStoredError = () => {
  const { t } = useTranslation()
  return (error: { code: string; message: string }): string =>
    isErrorCode(error.code) ? t(`errors.${error.code}`) : error.message
}

/** `context` of a stored error or notification, for the details dialog. */
export const formatContext = (context: Record<string, unknown>): string =>
  JSON.stringify(context, undefined, 2)
