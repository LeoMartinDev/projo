import { type ReactNode, useEffect, useId } from 'react'
import { useTranslation } from 'react-i18next'

import { CloseIcon } from './icons.tsx'
import { useElement } from './use-element.ts'

/**
 * Native modal `<dialog>`: focus trap, Escape and backdrop come from the browser. `fill` gives it a
 * fixed height whose body does not scroll: the content lays out its own scrolling region.
 */
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
      onClose={onClose}
      onCancel={(event) => {
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
