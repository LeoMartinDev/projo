import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { type FormEvent, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { api, request } from '../../shared/api/client.ts'
import { Backdrop } from '../../shared/backdrops/Backdrop.tsx'
import { signedIn } from '../../shared/session/session.ts'
import { Field, RevealButton } from '../../shared/ui/controls.tsx'
import { LockIcon, UserIcon } from '../../shared/ui/icons.tsx'
import { ErrorAlert } from '../../shared/ui/states.tsx'
import { Logo } from '../shell/Logo.tsx'
import './auth.css'

/** Only same-app paths are followed after login (no open redirect). */
const safeRedirect = (target: string | undefined): string =>
  target !== undefined && target.startsWith('/') && !target.startsWith('//') ? target : '/'

/** Login (§14). Not drawn: built like the first-launch steps, a glass panel over an illustration. */
export const LoginPage = ({ redirectTo }: { redirectTo?: string }) => {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [shown, setShown] = useState(false)

  const login = useMutation({
    mutationFn: () => request(() => api.auth.login.$post({ json: { username, password } })),
    onSuccess: async (me) => {
      signedIn(queryClient, me)
      await navigate({ href: safeRedirect(redirectTo), replace: true })
    },
  })

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!login.isPending) login.mutate()
  }

  return (
    <div className="auth">
      <Backdrop image="ocean" shade="split" />
      <header className="auth__header rise">
        <Logo />
      </header>
      <main className="auth__main">
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
        </form>
      </main>
    </div>
  )
}
