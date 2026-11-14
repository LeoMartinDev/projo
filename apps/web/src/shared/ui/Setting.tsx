import { type ReactNode, useId } from 'react'

import { Switch } from './controls.tsx'

/**
 * A settings row: its label (and a description under it) on the left, its control on the right.
 * `labelId` names the label for a control that points to it (`aria-labelledby`). A string
 * description is drawn muted; any other node (a link button) as it is.
 */
export const Setting = ({
  label,
  labelId,
  description,
  children,
}: {
  label: ReactNode
  labelId?: string
  description?: ReactNode
  children: ReactNode
}) => (
  <div className="setting">
    <div className="setting__text">
      <span {...(labelId === undefined ? {} : { id: labelId })} className="setting__label">
        {label}
      </span>
      {typeof description === 'string' ? (
        <span className="setting__description">{description}</span>
      ) : (
        description
      )}
    </div>
    {children}
  </div>
)

/** A setting turned on and off by a switch. */
export const SwitchSetting = ({
  label,
  description,
  checked,
  onChange,
  disabled = false,
}: {
  label: string
  description?: string
  checked: boolean
  onChange: (value: boolean) => void
  disabled?: boolean
}) => {
  const id = useId()
  return (
    <Setting label={label} labelId={id} {...(description === undefined ? {} : { description })}>
      <Switch checked={checked} labelId={id} disabled={disabled} onChange={onChange} />
    </Setting>
  )
}
