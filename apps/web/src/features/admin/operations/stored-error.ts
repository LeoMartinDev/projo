import { useTranslation } from 'react-i18next'

import { isErrorCode } from '@projo/shared/errors'

export const useStoredError = () => {
  const { t } = useTranslation()
  return (error: { code: string; message: string }): string =>
    isErrorCode(error.code) ? t(`errors.${error.code}`) : error.message
}

export const formatContext = (context: Record<string, unknown>): string =>
  JSON.stringify(context, undefined, 2)
