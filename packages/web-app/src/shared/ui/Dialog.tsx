import { type ReactNode, useEffect, useId } from 'react'
import { useTranslation } from 'react-i18next'

import { CloseIcon } from './icons.tsx'
import { useElement } from './use-element.ts'

export const Dialog = ({
  open,
  title,
  onClose,
  children,
  footer,
  fill = false,
}: {
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  fill?: boolean
}) => {
  const { t } = useTranslation()
  const titleId = useId()
  const [dialog, ref] = useElement<HTMLDialogElement>()

  useEffect(() => {
    if (dialog === undefined) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [dialog, open])

  return (
    <dialog
      ref={ref}
      className={fill ? 'dialog dialog--fill' : 'dialog'}
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
            <h2 id={titleId} className="dialog__title">
              {title}
            </h2>
            <button
              type="button"
              className="icon-button"
              aria-label={t('common.close')}
              onClick={onClose}
            >
              <CloseIcon />
            </button>
          </div>
          <div className="dialog__body">{children}</div>
          {footer === undefined ? undefined : <div className="dialog__footer">{footer}</div>}
        </>
      ) : undefined}
    </dialog>
  )
}
