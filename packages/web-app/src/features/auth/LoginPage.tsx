import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { type FormEvent, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { MeResponse } from '@projo/shared/api/auth'

import { api, request } from '../../shared/api/client.ts'
import { Backdrop } from '../../shared/backdrops/Backdrop.tsx'
import { safeRedirect } from '../../shared/session/safe-redirect.ts'
import {
  claimPairing,
  completeSignIn,
  signedIn,
  signInOptions,
} from '../../shared/session/session.ts'
import { Field, RevealButton } from '../../shared/ui/controls.tsx'
import { LockIcon, ShieldIcon, UserIcon } from '../../shared/ui/icons.tsx'
import { ErrorAlert } from '../../shared/ui/states.tsx'
import { Logo } from '../shell/Logo.tsx'
import { type HostSession, useHost } from '../../host.ts'
import { normalizePairingCode } from './pairing-code.ts'
import './auth.css'

type TokenSession = Extract<HostSession, { kind: 'token' }>

const useSignedIn = (redirectTo: string | undefined) => {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  return async (me: MeResponse) => {
    signedIn(queryClient, me)
    await navigate({ href: safeRedirect(redirectTo), replace: true })
  }
}

const PasswordForm = ({
  session,
  redirectTo,
  onUseCode,
}: {
  session: HostSession
  redirectTo: string | undefined
  onUseCode: (() => void) | undefined
}) => {
  const { t } = useTranslation()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [shown, setShown] = useState(false)
  const onSignedIn = useSignedIn(redirectTo)

  const login = useMutation({
    mutationFn: async () =>
      completeSignIn(
        session,
        await request(() =>
          api.auth.login.$post({ json: { username, password, ...signInOptions(session) } }),
        ),
      ),
    onSuccess: onSignedIn,
  })

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!login.isPending) login.mutate()
  }

  return (
    <form className="panel auth__panel rise r2" onSubmit={submit} noValidate>
      <h1 className="auth__title">{t('login.title')}</h1>
      {login.isError ? <ErrorAlert error={login.error} /> : undefined}
      <Field id="login-username" label={t('login.username')} icon={<UserIcon />}>
        <input
          id="login-username"
          className="field__input"
          name="username"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          required
          value={username}
          onChange={(event) => setUsername(event.target.value)}
        />
      </Field>
      <Field
        id="login-password"
        label={t('login.password')}
        icon={<LockIcon />}
        trail={<RevealButton shown={shown} onToggle={() => setShown(!shown)} />}
      >
        <input
          id="login-password"
          className="field__input"
          type={shown ? 'text' : 'password'}
          name="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
      </Field>
      <button
        type="submit"
        className="button button--primary button--large auth__submit"
        disabled={login.isPending || username.length === 0 || password.length === 0}
      >
        {login.isPending ? <span className="spinner" aria-hidden="true" /> : undefined}
        {t('login.submit')}
      </button>
      {onUseCode === undefined ? undefined : (
        <button type="button" className="button button--large" onClick={onUseCode}>
          {t('login.useCode')}
        </button>
      )}
    </form>
  )
}

/** Sign-in with a pairing code from Account → Connect a device (token hosts only, §28.3). */
const CodeForm = ({
  session,
  redirectTo,
  onUseCredentials,
}: {
  session: TokenSession
  redirectTo: string | undefined
  onUseCredentials: () => void
}) => {
  const { t } = useTranslation()
  const [code, setCode] = useState('')
  const onSignedIn = useSignedIn(redirectTo)
  const normalized = normalizePairingCode(code)

  const claim = useMutation({
    mutationFn: () => claimPairing(session, normalized),
    onSuccess: onSignedIn,
  })

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!claim.isPending && normalized !== '') claim.mutate()
  }

  return (
    <form className="panel auth__panel rise r2" onSubmit={submit} noValidate>
      <h1 className="auth__title">{t('login.codeTitle')}</h1>
      {claim.isError ? <ErrorAlert error={claim.error} /> : undefined}
      <Field id="login-code" label={t('login.code')} icon={<ShieldIcon />}>
        <input
          id="login-code"
          className="field__input"
          name="code"
          autoComplete="one-time-code"
          autoCapitalize="characters"
          spellCheck={false}
          required
          value={code}
          onChange={(event) => setCode(event.target.value)}
        />
      </Field>
      <button
        type="submit"
        className="button button--primary button--large auth__submit"
        disabled={claim.isPending || normalized === ''}
      >
        {claim.isPending ? <span className="spinner" aria-hidden="true" /> : undefined}
        {t('login.codeSubmit')}
      </button>
      <button type="button" className="button button--large" onClick={onUseCredentials}>
        {t('login.useCredentials')}
      </button>
    </form>
  )
}

export const LoginPage = ({ redirectTo }: { redirectTo?: string }) => {
  const { session } = useHost()
  const [withCode, setWithCode] = useState(false)

  return (
    <div className="auth">
      <Backdrop image="ocean" shade="split" />
      <header className="auth__header rise">
        <Logo />
      </header>
      <main className="auth__main">
        {session.kind === 'token' && withCode ? (
          <CodeForm
            session={session}
            redirectTo={redirectTo}
            onUseCredentials={() => setWithCode(false)}
          />
        ) : (
          <PasswordForm
            session={session}
            redirectTo={redirectTo}
            onUseCode={session.kind === 'token' ? () => setWithCode(true) : undefined}
          />
        )}
      </main>
    </div>
  )
}
