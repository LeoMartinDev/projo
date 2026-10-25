import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { type FormEvent, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { passwordSchema, profileNameSchema, usernameSchema } from '@projo/shared/api/auth'

import { api, request } from '../../shared/api/client.ts'
import { toApiFailure } from '../../shared/api/failure.ts'
import { Backdrop } from '../../shared/backdrops/Backdrop.tsx'
import { currentLocale } from '../../shared/i18n/index.ts'
import { profileSelected } from '../../shared/session/session.ts'
import { Field, RevealButton, ValidMark } from '../../shared/ui/controls.tsx'
import { ArrowRightIcon, LockIcon, ShieldIcon, UserIcon } from '../../shared/ui/icons.tsx'
import { ErrorAlert, FullPageSpinner } from '../../shared/ui/states.tsx'
import { passwordScore } from '../setup/password-strength.ts'
import { Logo } from '../shell/Logo.tsx'
import '../setup/setup.css'
import './invite.css'

const strengthKeys = ['empty', 'weak', 'fair', 'good', 'strong'] as const

/** Unusable invitation (unknown or withdrawn, expired, already used): one sentence, the login. */
const InvitationGone = ({ error }: { error: unknown }) => {
  const { t } = useTranslation()
  const code = toApiFailure(error).code
  const title =
    code === 'auth/invitation_expired'
      ? t('invite.expired')
      : code === 'auth/invitation_used'
        ? t('invite.used')
        : code === 'auth/invitation_invalid'
          ? t('invite.invalid')
          : t('common.errorTitle')
  return (
    <main className="onb__main onb__main--center">
      <h1 className="onb__hero onb__hero--center invite__gone rise r1">{title}</h1>
      {code === 'auth/invitation_expired' ||
      code === 'auth/invitation_used' ||
      code === 'auth/invitation_invalid' ? (
        <p className="invite__text rise r2">{t('invite.askAgain')}</p>
      ) : (
        <div className="rise r2">
          <ErrorAlert error={error} />
        </div>
      )}
      <Link to="/login" className="button button--glass button--large rise r3">
        {t('login.submit')}
      </Link>
    </main>
  )
}

const InviteForm = ({ token, serverName }: { token: string; serverName?: string }) => {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [shown, setShown] = useState(false)
  const [usernameLeft, setUsernameLeft] = useState(false)

  const nameValid = profileNameSchema.safeParse(name).success
  const usernameValid = usernameSchema.safeParse(username).success
  const passwordValid = passwordSchema.safeParse(password).success
  const matches = confirmation.length > 0 && confirmation === password
  const mismatch = !matches && confirmation.length > 0 && confirmation.length >= password.length
  const score = passwordScore(password)
  const ready = nameValid && usernameValid && passwordValid && matches
  const usernameWrong = usernameLeft && username.length > 0 && !usernameValid

  const accept = useMutation({
    mutationFn: () =>
      request(() =>
        api.invitations[':token'].accept.$post({
          param: { token },
          json: {
            username,
            password,
            uiLocale: currentLocale(),
            profile: { name: name.trim() },
          },
        }),
      ),
    onSuccess: async (me) => {
      profileSelected(queryClient, me)
      await navigate({ to: '/', replace: true })
    },
  })

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (ready && !accept.isPending) accept.mutate()
  }
  const type = shown ? 'text' : 'password'

  return (
    <main className="onb__main onb__main--split">
      <h1 className="onb__display rise r1">
        {serverName === undefined
          ? t('invite.display')
          : t('invite.displayServer', { name: serverName })}
      </h1>
      <form
        className="panel onb__panel rise r2"
        aria-labelledby="invite-title"
        onSubmit={submit}
        noValidate
      >
        <h2 id="invite-title" className="onb__panel-title">
          {t('invite.title')}
        </h2>
        {accept.isError ? <ErrorAlert error={accept.error} /> : undefined}
        <div className="onb__fields">
          <Field
            id="invite-name"
            label={t('invite.name')}
            icon={<UserIcon />}
            trail={nameValid ? <ValidMark label={t('common.valid')} /> : undefined}
          >
            <input
              id="invite-name"
              className="field__input"
              autoComplete="given-name"
              maxLength={32}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
          <div className="form-row">
            <Field
              id="invite-username"
              label={t('setup.account.username')}
              invalid={usernameWrong}
              trail={usernameValid ? <ValidMark label={t('common.valid')} /> : undefined}
            >
              <input
                id="invite-username"
                className="field__input"
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                value={username}
                aria-invalid={usernameWrong}
                aria-describedby={usernameWrong ? 'invite-username-rule' : undefined}
                onBlur={() => setUsernameLeft(true)}
                onChange={(event) => setUsername(event.target.value)}
              />
            </Field>
            {usernameWrong ? (
              <span id="invite-username-rule" className="hint hint--error">
                {t('setup.account.usernameRule')}
              </span>
            ) : undefined}
          </div>
          <div className="form-row">
            <Field
              id="invite-password"
              label={t('setup.account.password')}
              icon={<LockIcon />}
              trail={<RevealButton shown={shown} onToggle={() => setShown(!shown)} />}
            >
              <input
                id="invite-password"
                className="field__input"
                type={type}
                autoComplete="new-password"
                value={password}
                aria-describedby="invite-password-strength"
                onChange={(event) => setPassword(event.target.value)}
              />
            </Field>
            <div className="meter" aria-hidden="true">
              {[1, 2, 3, 4].map((level) => (
                <span key={level} className="meter__segment" data-on={score >= level} />
              ))}
            </div>
            <span id="invite-password-strength" className="hint" aria-live="polite">
              {t('setup.account.strength')}{' '}
              <strong>{t(`setup.strength.${strengthKeys[score]}`)}</strong>
              {passwordValid ? undefined : ` · ${t('setup.account.passwordRule')}`}
            </span>
          </div>
          <div className="form-row">
            <Field
              id="invite-confirmation"
              label={t('setup.account.confirmation')}
              icon={<ShieldIcon />}
              invalid={mismatch}
              trail={matches ? <ValidMark label={t('setup.account.matches')} /> : undefined}
            >
              <input
                id="invite-confirmation"
                className="field__input"
                type={type}
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
        <div className="onb__actions invite__actions">
          <button
            type="submit"
            className="button button--primary"
            disabled={!ready || accept.isPending}
          >
            {accept.isPending ? <span className="spinner" aria-hidden="true" /> : undefined}
            {t('invite.submit')}
            <span className="button__arrow" aria-hidden="true">
              <ArrowRightIcon size={17} />
            </span>
          </button>
        </div>
      </form>
    </main>
  )
}

/**
 * `/invite/$token` (§4 parcours 2, §14): a public page in the first-launch style. A valid
 * invitation asks for the first name of the first profile, a username and a password, then signs
 * in and opens the home.
 */
export const InvitePage = ({ token }: { token: string }) => {
  const status = useQuery({
    queryKey: ['invitation', token],
    queryFn: () => request(() => api.invitations[':token'].$get({ param: { token } })),
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
  })
  return (
    <div className="onb">
      <Backdrop image="forest" shade="split" />
      <header className="onb__header">
        <span className="rise">
          <Logo />
        </span>
      </header>
      {status.isPending ? (
        <main className="onb__main onb__main--center">
          <FullPageSpinner />
        </main>
      ) : status.isError ? (
        <InvitationGone error={status.error} />
      ) : (
        <InviteForm
          token={token}
          {...(status.data.serverName === undefined ? {} : { serverName: status.data.serverName })}
        />
      )}
    </div>
  )
}
