import { useMutation } from '@tanstack/react-query'
import { type FormEvent, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { MeResponse } from '@projo/shared/api/auth'
import { passwordSchema, profileNameSchema, usernameSchema } from '@projo/shared/api/auth'

import { api, request } from '../../shared/api/client.ts'
import { currentLocale } from '../../shared/i18n/index.ts'
import { Field, RevealButton, ValidMark } from '../../shared/ui/controls.tsx'
import { ArrowRightIcon, LockIcon, ShieldIcon } from '../../shared/ui/icons.tsx'
import { ErrorAlert } from '../../shared/ui/states.tsx'
import { passwordScore } from './password-strength.ts'
import { StepScreen } from './SetupLayout.tsx'

const strengthKeys = ['empty', 'weak', 'fair', 'good', 'strong'] as const

/**
 * Step 1, artboard `OnbAccount`: first name, username, password with its strength, confirmation.
 * `POST /setup` creates the admin and its profile and signs it in. Server name and metadata
 * language keep their defaults (§15 "Premier lancement"): the latter follows the interface.
 */
export const AccountStep = ({
  onBack,
  onDone,
}: {
  onBack: () => void
  onDone: (me: MeResponse) => void
}) => {
  const { t } = useTranslation()
  const [name, setName] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [shown, setShown] = useState(false)
  const [usernameLeft, setUsernameLeft] = useState(false)

  const nameValid = name.trim().length === 0 || profileNameSchema.safeParse(name).success
  const usernameValid = usernameSchema.safeParse(username).success
  const passwordValid = passwordSchema.safeParse(password).success
  const matches = confirmation.length > 0 && confirmation === password
  const mismatch = !matches && confirmation.length > 0 && confirmation.length >= password.length
  const score = passwordScore(password)
  const ready = nameValid && usernameValid && passwordValid && matches

  const setup = useMutation({
    mutationFn: () => {
      const uiLocale = currentLocale()
      return request(() =>
        api.setup.$post({
          json: {
            username,
            password,
            uiLocale,
            metadataLanguage: uiLocale === 'fr' ? 'fr-FR' : 'en-US',
            profile: name.trim().length === 0 ? {} : { name: name.trim() },
          },
        }),
      )
    },
    onSuccess: onDone,
  })

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (ready && !setup.isPending) setup.mutate()
  }

  const fieldType = shown ? 'text' : 'password'

  return (
    <StepScreen step="account" image="mountains" title={t('setup.account.display')}>
      <form
        className="panel onb__panel rise r2"
        aria-labelledby="setup-account-title"
        onSubmit={submit}
        noValidate
      >
        <h2 id="setup-account-title" className="onb__panel-title">
          {t('setup.account.title')}
        </h2>
        {setup.isError ? <ErrorAlert error={setup.error} /> : undefined}

        <div className="onb__fields">
          <div className="onb__pair">
            <Field id="setup-name" label={t('setup.account.name')} invalid={!nameValid}>
              <input
                id="setup-name"
                className="field__input"
                autoComplete="given-name"
                maxLength={32}
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </Field>
            <div className="form-row">
              <Field
                id="setup-username"
                label={t('setup.account.username')}
                invalid={usernameLeft && username.length > 0 && !usernameValid}
                trail={usernameValid ? <ValidMark label={t('common.valid')} /> : undefined}
              >
                <input
                  id="setup-username"
                  className="field__input"
                  autoComplete="username"
                  autoCapitalize="none"
                  spellCheck={false}
                  value={username}
                  aria-invalid={usernameLeft && username.length > 0 && !usernameValid}
                  aria-describedby={
                    usernameLeft && username.length > 0 && !usernameValid
                      ? 'setup-username-rule'
                      : undefined
                  }
                  onBlur={() => setUsernameLeft(true)}
                  onChange={(event) => setUsername(event.target.value)}
                />
              </Field>
            </div>
          </div>
          {usernameLeft && username.length > 0 && !usernameValid ? (
            <span id="setup-username-rule" className="hint hint--error">
              {t('setup.account.usernameRule')}
            </span>
          ) : undefined}

          <div className="form-row">
            <Field
              id="setup-password"
              label={t('setup.account.password')}
              icon={<LockIcon />}
              trail={<RevealButton shown={shown} onToggle={() => setShown(!shown)} />}
            >
              <input
                id="setup-password"
                className="field__input"
                type={fieldType}
                autoComplete="new-password"
                value={password}
                aria-describedby="setup-password-strength"
                onChange={(event) => setPassword(event.target.value)}
              />
            </Field>
            <div className="meter" aria-hidden="true">
              {[1, 2, 3, 4].map((level) => (
                <span key={level} className="meter__segment" data-on={score >= level} />
              ))}
            </div>
            <span id="setup-password-strength" className="hint" aria-live="polite">
              {t('setup.account.strength')}{' '}
              <strong>{t(`setup.strength.${strengthKeys[score]}`)}</strong>
              {passwordValid ? undefined : ` · ${t('setup.account.passwordRule')}`}
            </span>
          </div>

          <div className="form-row">
            <Field
              id="setup-confirmation"
              label={t('setup.account.confirmation')}
              icon={<ShieldIcon />}
              invalid={mismatch}
              trail={matches ? <ValidMark label={t('setup.account.matches')} /> : undefined}
            >
              <input
                id="setup-confirmation"
                className="field__input"
                type={fieldType}
                autoComplete="new-password"
                value={confirmation}
                aria-invalid={mismatch}
                onChange={(event) => setConfirmation(event.target.value)}
              />
            </Field>
            {mismatch ? (
              <span className="hint hint--error">{t('setup.account.mismatch')}</span>
            ) : undefined}
          </div>
        </div>

        <div className="onb__actions">
          <button type="button" className="button" onClick={onBack}>
            {t('common.back')}
          </button>
          <button
            type="submit"
            className="button button--primary"
            disabled={!ready || setup.isPending}
          >
            {setup.isPending ? <span className="spinner" aria-hidden="true" /> : undefined}
            {t('common.continue')}
            <span className="button__arrow" aria-hidden="true">
              <ArrowRightIcon size={17} />
            </span>
          </button>
        </div>
      </form>
    </StepScreen>
  )
}
