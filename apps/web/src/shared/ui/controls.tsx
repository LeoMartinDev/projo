import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { CheckIcon, ChevronDownIcon, EyeIcon, EyeOffIcon } from './icons.tsx'

/**
 * Kit v2 form controls (artboard `Components`): the field box with its label inside, the
 * switch, the checkbox row. The input itself is the caller's (`className="field__input"`), so
 * every native attribute stays available.
 */
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

/** Chevron of a `<select>` field (the native arrow is hidden). */
export const SelectChevron = () => (
  <span className="field__chevron" aria-hidden="true">
    <ChevronDownIcon />
  </span>
)

/** The check that pops in at the end of a valid field. */
export const ValidMark = ({ label }: { label: string }) => (
  <span className="valid-mark" role="img" aria-label={label}>
    <CheckIcon size={12} stroke={3} />
  </span>
)

/** Show / hide toggle at the end of a password field. */
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

/** A full-width checkbox row: box, then whatever the row shows. */
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
