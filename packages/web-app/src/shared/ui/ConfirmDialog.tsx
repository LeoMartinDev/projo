import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { Dialog } from './Dialog.tsx'
import { ErrorAlert } from './states.tsx'

/**
 * Asks before an action: a cancel button, then the confirm button (a spinner while `pending`, which
 * also locks the dialog open). `form` makes the confirm button submit that form instead of calling
 * `onConfirm`, for a dialog that asks for a value (a password, the account's name).
 */
export const ConfirmDialog = ({
  title,
  text,
  confirmLabel,
  tone = 'primary',
  pending = false,
  disabled = false,
  error,
  onConfirm,
  form,
  onClose,
  children,
}: {
  title: string
  /** The paragraph under the title. */
  text?: string
  confirmLabel: string
  tone?: 'primary' | 'danger'
  pending?: boolean
  /** Confirm stays disabled (an awaited value is still missing). */
  disabled?: boolean
  /** Shown under the content when set (the failed mutation's error). */
  error?: unknown
  onConfirm?: () => void
  form?: string
  onClose: () => void
  children?: ReactNode
}) => {
  const { t } = useTranslation()
  return (
    <Dialog
      open
      title={title}
      onClose={() => {
        if (!pending) onClose()
      }}
      footer={
        <>
          <button type="button" className="button" disabled={pending} onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button
            type={form === undefined ? 'button' : 'submit'}
            {...(form === undefined ? {} : { form })}
            className={`button button--${tone}`}
            disabled={pending || disabled}
            {...(onConfirm === undefined ? {} : { onClick: onConfirm })}
          >
            {pending ? <span className="spinner" aria-hidden="true" /> : undefined}
            {confirmLabel}
          </button>
        </>
      }
    >
      {text === undefined ? undefined : <p className="dialog__text">{text}</p>}
      {children}
      {error === undefined ? undefined : <ErrorAlert error={error} />}
    </Dialog>
  )
}
