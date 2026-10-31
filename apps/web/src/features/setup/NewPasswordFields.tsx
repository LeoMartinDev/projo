import { type ReactNode, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { passwordSchema } from '@projo/shared/api/auth'

import { Field, ValidMark } from '../../shared/ui/controls.tsx'
import { LockIcon, ShieldIcon } from '../../shared/ui/icons.tsx'
import { passwordScore } from './password-strength.ts'

const strengthKeys = ['empty', 'weak', 'fair', 'good', 'strong'] as const

/** A new password and its confirmation: the rule (§14), the match, the mismatch shown once typed. */
export const usePasswordPair = () => {
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const valid = passwordSchema.safeParse(password).success
  const matches = confirmation.length > 0 && confirmation === password
  const mismatch = !matches && confirmation.length > 0 && confirmation.length >= password.length
  return {
    password,
    setPassword,
    confirmation,
    setConfirmation,
    valid,
    matches,
    mismatch,
    ready: valid && matches,
    clear: () => {
      setPassword('')
      setConfirmation('')
    },
  }
}

export type PasswordPair = ReturnType<typeof usePasswordPair>

/**
 * The new password with its strength meter, then its confirmation (first launch, invitation,
 * account page). `reveal`: the show/hide button, on the password field when the form has no
 * other password field to carry it.
 */
export const NewPasswordFields = ({
  id,
  pair,
  shown,
  reveal,
  labels,
}: {
  id: string
  pair: PasswordPair
  shown: boolean
  reveal?: ReactNode
  labels?: { password: string; confirmation: string }
}) => {
  const { t } = useTranslation()
  const score = passwordScore(pair.password)
  const type = shown ? 'text' : 'password'
  return (
    <>
      <div className="form-row">
        <Field
          id={`${id}-password`}
          label={labels?.password ?? t('setup.account.password')}
          icon={<LockIcon />}
          {...(reveal === undefined ? {} : { trail: reveal })}
        >
          <input
            id={`${id}-password`}
            className="field__input"
            type={type}
            autoComplete="new-password"
            value={pair.password}
            aria-describedby={`${id}-password-strength`}
            onChange={(event) => pair.setPassword(event.target.value)}
          />
        </Field>
        <div className="meter" aria-hidden="true">
          {[1, 2, 3, 4].map((level) => (
            <span key={level} className="meter__segment" data-on={score >= level} />
          ))}
        </div>
        <span id={`${id}-password-strength`} className="hint" aria-live="polite">
          {t('setup.account.strength')}{' '}
          <strong>{t(`setup.strength.${strengthKeys[score]}`)}</strong>
          {pair.valid ? undefined : ` · ${t('setup.account.passwordRule')}`}
        </span>
      </div>

      <div className="form-row">
        <Field
          id={`${id}-confirmation`}
          label={labels?.confirmation ?? t('setup.account.confirmation')}
          icon={<ShieldIcon />}
          invalid={pair.mismatch}
          trail={pair.matches ? <ValidMark label={t('setup.account.matches')} /> : undefined}
        >
          <input
            id={`${id}-confirmation`}
            className="field__input"
            type={type}
            autoComplete="new-password"
            value={pair.confirmation}
            aria-invalid={pair.mismatch}
            onChange={(event) => pair.setConfirmation(event.target.value)}
          />
        </Field>
        {pair.mismatch ? (
          <span className="hint hint--error">{t('setup.account.mismatch')}</span>
        ) : undefined}
      </div>
    </>
  )
}
