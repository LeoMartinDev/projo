import { type ReactNode, useEffect, useId } from 'react'
import { useTranslation } from 'react-i18next'

import { CloseIcon } from './icons.tsx'
import { useElement } from './use-element.ts'

/**
 * A modal dialog. `subtitle`: a line under the title (a record's state); `actions`: buttons beside
 * the close button (a record's menu); `tabs`: a tab bar that stays above the scrolling body.
 * `fill`: a fixed height whose body does not scroll (its panes do); `large`: a wider dialog of a
 * fixed height whose body scrolls (a record's details). Closing gives the focus back to what had
 * it when the dialog opened.
 */
export const Dialog = ({
  open,
  title,
  subtitle,
  actions,
  tabs,
  onClose,
  children,
  footer,
  fill = false,
  large = false,
}: {
  open: boolean
  title: string
  subtitle?: ReactNode
  actions?: ReactNode
  tabs?: ReactNode
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  fill?: boolean
  large?: boolean
}) => {
  const { t } = useTranslation()
  const titleId = useId()
  const [dialog, ref] = useElement<HTMLDialogElement>()

  // Declared before the effect that opens the dialog: it reads the focus before the dialog takes it.
  useEffect(() => {
    if (!open) return
    const previous = document.activeElement
    return () => {
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus()
    }
  }, [open])

  useEffect(() => {
    if (dialog === undefined) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [dialog, open])

  return (
    <dialog
      ref={ref}
      className={['dialog', fill ? 'dialog--fill' : '', large ? 'dialog--large' : '']
        .filter((name) => name !== '')
        .join(' ')}
      aria-labelledby={titleId}
      onClose={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
      onCancel={(event) => {
        if (event.target !== event.currentTarget) return
        event.preventDefault()
        onClose()
      }}
    >
      {open ? (
        <>
          <div className="dialog__header">
            <div className="dialog__heading">
              <h2 id={titleId} className="dialog__title">
                {title}
              </h2>
              {subtitle === undefined ? undefined : (
                <div className="dialog__subtitle">{subtitle}</div>
              )}
            </div>
            <div className="dialog__actions">
              {actions}
              <button
                type="button"
                className="icon-button"
                aria-label={t('common.close')}
                onClick={onClose}
              >
                <CloseIcon />
              </button>
            </div>
          </div>
          {tabs === undefined ? undefined : <div className="dialog__tabs">{tabs}</div>}
          <div className="dialog__body">{children}</div>
          {footer === undefined ? undefined : <div className="dialog__footer">{footer}</div>}
        </>
      ) : undefined}
    </dialog>
  )
}
