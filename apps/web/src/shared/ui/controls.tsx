import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { CheckIcon, EyeIcon, EyeOffIcon } from './icons.tsx'

export const Field = ({
  id,
  label,
  icon,
  invalid = false,
  compact = false,
  trail,
  children,
}: {
  id: string
  label: string
  icon?: ReactNode
  invalid?: boolean
  compact?: boolean
  trail?: ReactNode
  children: ReactNode
}) => (
  <div className={compact ? 'field field--compact' : 'field'} data-invalid={invalid}>
    {icon === undefined ? undefined : (
      <span className="field__icon" aria-hidden="true">
        {icon}
      </span>
    )}
    <div className="field__stack">
      <label className={compact ? 'visually-hidden' : 'field__label'} htmlFor={id}>
        {label}
      </label>
      {children}
    </div>
    {trail}
  </div>
)

export const ValidMark = ({ label }: { label: string }) => (
  <span className="valid-mark" role="img" aria-label={label}>
    <CheckIcon size={12} stroke={3} />
  </span>
)

export const RevealButton = ({ shown, onToggle }: { shown: boolean; onToggle: () => void }) => {
  const { t } = useTranslation()
  return (
    <span className="field__trail">
      <button
        type="button"
        className="icon-button"
        aria-pressed={shown}
        aria-label={shown ? t('common.hidePassword') : t('common.showPassword')}
        onClick={onToggle}
      >
        {shown ? <EyeOffIcon /> : <EyeIcon />}
      </button>
    </span>
  )
}

export const Switch = ({
  checked,
  labelId,
  onChange,
  disabled = false,
}: {
  checked: boolean
  labelId: string
  onChange: (value: boolean) => void
  disabled?: boolean
}) => (
  <button
    type="button"
    role="switch"
    className="switch"
    aria-checked={checked}
    aria-labelledby={labelId}
    disabled={disabled}
    onClick={() => onChange(!checked)}
  >
    <span className="switch__track" aria-hidden="true">
      <span className="switch__knob" />
    </span>
  </button>
)

export const Checkrow = ({
  checked,
  onChange,
  children,
}: {
  checked: boolean
  onChange: (value: boolean) => void
  children: ReactNode
}) => (
  <button
    type="button"
    role="checkbox"
    className="checkrow"
    aria-checked={checked}
    onClick={() => onChange(!checked)}
  >
    <span className="checkrow__box" aria-hidden="true">
      <CheckIcon size={13} stroke={3.2} />
    </span>
    {children}
  </button>
)
