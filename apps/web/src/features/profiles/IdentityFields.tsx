import { useId } from 'react'
import { useTranslation } from 'react-i18next'

import { type AvatarColor, avatarColorSchema } from '@projo/shared/api/profiles'

import { Field, Switch } from '../../shared/ui/controls.tsx'
import { CheckIcon } from '../../shared/ui/icons.tsx'

const colors = avatarColorSchema.options

/** The six avatar colours (§13.6), as a radio group of swatches. */
export const ColorSwatches = ({
  value,
  onChange,
}: {
  value: AvatarColor | undefined
  onChange: (color: AvatarColor) => void
}) => {
  const { t } = useTranslation()
  const name = useId()
  return (
    <fieldset className="swatches">
      <legend className="swatches__legend">{t('profiles.editor.color')}</legend>
      <div className="swatches__list">
        {colors.map((color) => (
          <label key={color} className={`swatch avatar--${color}`}>
            <input
              type="radio"
              name={name}
              className="visually-hidden"
              value={color}
              checked={value === color}
              onChange={() => onChange(color)}
            />
            <span className="visually-hidden">{t(`profiles.colors.${color}`)}</span>
            <span className="swatch__check" aria-hidden="true">
              <CheckIcon size={16} stroke={2.6} />
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  )
}

/**
 * The optional 4-digit PIN of a profile (§13.6): a switch, a "change" link when one is set, and
 * the field for the new code. `hasPin` is the stored state; the draft is `on`, `changing`, `pin`.
 */
export const PinFields = ({
  hasPin,
  on,
  changing,
  pin,
  valid,
  needsNewPin,
  onToggle,
  onChange,
  onChanging,
}: {
  hasPin: boolean
  on: boolean
  changing: boolean
  pin: string
  valid: boolean
  needsNewPin: boolean
  onToggle: (on: boolean) => void
  onChange: (pin: string) => void
  onChanging: () => void
}) => {
  const { t } = useTranslation()
  const ids = useId()
  return (
    <>
      <div className="setting">
        <div className="setting__text">
          <span id={`${ids}-label`} className="setting__label">
            {t('profiles.editor.pin')}
          </span>
          {hasPin && on && !changing ? (
            <button type="button" className="link-button" onClick={onChanging}>
              {t('profiles.editor.changePin')}
            </button>
          ) : undefined}
        </div>
        <Switch checked={on} labelId={`${ids}-label`} onChange={onToggle} />
      </div>
      <Field
        id={`${ids}-pin`}
        label={t('profiles.editor.newPin')}
        invalid={pin.length === 4 && !valid}
      >
        <input
          id={`${ids}-pin`}
          className="field__input mono"
          type="password"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={4}
          autoComplete="new-password"
          value={pin}
          disabled={!needsNewPin}
          placeholder={on && !needsNewPin ? '••••' : ''}
          onChange={(event) => onChange(event.target.value.replace(/\D/g, '').slice(0, 4))}
        />
      </Field>
    </>
  )
}
