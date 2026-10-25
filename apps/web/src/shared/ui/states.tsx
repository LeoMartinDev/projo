import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { useErrorMessage } from '../i18n/errors.ts'

/** Empty state: a title, an optional sentence and an optional action. */
export const EmptyState = ({
  title,
  text,
  action,
}: {
  title: string
  text?: string
  action?: ReactNode
}) => (
  <div className="state">
    <p className="state__title">{title}</p>
    {text === undefined ? undefined : <p className="state__text">{text}</p>}
    {action}
  </div>
)

/** Error state: the translated API error and a retry button (§19 "States"). */
export const ErrorState = ({ error, onRetry }: { error: unknown; onRetry?: () => void }) => {
  const { t } = useTranslation()
  const message = useErrorMessage()
  return (
    <div className="state state--error" role="alert">
      <p className="state__title">{t('common.errorTitle')}</p>
      <p className="state__text">{message(error)}</p>
      {onRetry === undefined ? undefined : (
        <button type="button" className="button button--glass" onClick={onRetry}>
          {t('common.retry')}
        </button>
      )}
    </div>
  )
}

/** Inline error for forms. */
export const ErrorAlert = ({ error }: { error: unknown }) => {
  const message = useErrorMessage()
  return (
    <p className="alert" role="alert">
      {message(error)}
    </p>
  )
}

export const FullPageSpinner = () => {
  const { t } = useTranslation()
  return (
    <div className="state" role="status">
      <span className="spinner spinner--large" aria-hidden="true" />
      <span className="visually-hidden">{t('common.loading')}</span>
    </div>
  )
}
