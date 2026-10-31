import { useMutation } from '@tanstack/react-query'
import { type FormEvent, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { MeResponse } from '@projo/shared/api/auth'
import { profileNameSchema, usernameSchema } from '@projo/shared/api/auth'

import { api, request } from '../../shared/api/client.ts'
import { currentLocale } from '../../shared/i18n/index.ts'
import { Field, RevealButton, ValidMark } from '../../shared/ui/controls.tsx'
import { ArrowRightIcon } from '../../shared/ui/icons.tsx'
import { ErrorAlert } from '../../shared/ui/states.tsx'
import { NewPasswordFields, usePasswordPair } from './NewPasswordFields.tsx'
import { StepScreen } from './SetupLayout.tsx'

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
  const pair = usePasswordPair()
  const [shown, setShown] = useState(false)
  const [usernameLeft, setUsernameLeft] = useState(false)

  const nameValid = name.trim().length === 0 || profileNameSchema.safeParse(name).success
  const usernameValid = usernameSchema.safeParse(username).success
  const ready = nameValid && usernameValid && pair.ready

  const setup = useMutation({
    mutationFn: () => {
      const uiLocale = currentLocale()
      return request(() =>
        api.setup.$post({
          json: {
            username,
            password: pair.password,
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

          <NewPasswordFields
            id="setup"
            pair={pair}
            shown={shown}
            reveal={<RevealButton shown={shown} onToggle={() => setShown(!shown)} />}
          />
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
