import { useMutation, useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { type ReactNode, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { OAuthAuthorizeQuery, OAuthConsentDto } from '@projo/shared/api/oauth'

import { api, request } from '../../shared/api/client.ts'
import { apiFailure } from '../../shared/api/failure.ts'
import { Backdrop } from '../../shared/backdrops/Backdrop.tsx'
import { AlertIcon } from '../../shared/ui/icons.tsx'
import { ErrorAlert } from '../../shared/ui/states.tsx'
import { Logo } from '../shell/Logo.tsx'
import { readAuthorizeQuery } from './authorize-query.ts'
import '../auth/auth.css'
import './oauth.css'

/** The login's composition: the backdrop, the logo, one glass panel. */
const Screen = ({ children }: { children: ReactNode }) => (
  <div className="auth">
    <Backdrop image="ocean" shade="split" />
    <header className="auth__header rise">
      <Logo />
    </header>
    <main className="auth__main">
      <section className="panel auth__panel oauth rise r2">{children}</section>
    </main>
  </div>
)

/** An unusable request: the reason, and the way home. Never a redirect to the client. */
const Failed = ({ error }: { error: unknown }) => {
  const { t } = useTranslation()
  return (
    <>
      <h1 className="auth__title">{t('oauth.failedTitle')}</h1>
      <ErrorAlert error={error} />
      <Link to="/" className="button button--glass button--large oauth__end">
        {t('common.home')}
      </Link>
    </>
  )
}

/** The decision, posted with the request; the answer says where the browser goes next. */
const useDecision = (query: OAuthAuthorizeQuery) =>
  useMutation({
    mutationFn: (decision: 'allow' | 'deny') =>
      request(() => api.oauth.authorize.$post({ json: { ...query, decision } })),
    onSuccess: ({ redirectTo }) => window.location.assign(redirectTo),
  })

const Consent = ({ query, consent }: { query: OAuthAuthorizeQuery; consent: OAuthConsentDto }) => {
  const { t } = useTranslation()
  const decide = useDecision(query)
  // Still disabled once answered: the browser is leaving for the client.
  const busy = decide.isPending || decide.isSuccess
  const spinner = (decision: 'allow' | 'deny') =>
    decide.isPending && decide.variables === decision ? (
      <span className="spinner" aria-hidden="true" />
    ) : undefined

  return (
    <>
      <h1 className="auth__title">{t('oauth.title', { client: consent.client.name })}</h1>
      {consent.canAuthorize ? (
        <>
          <dl className="oauth__details">
            <dt>{t('oauth.redirectHost')}</dt>
            <dd className="oauth__host mono">{consent.client.redirectHost}</dd>
            <dt>{t('oauth.profile')}</dt>
            <dd>{consent.profile?.name ?? '—'}</dd>
          </dl>
          {consent.client.loopback ? (
            <p className="alert alert--warning">
              <AlertIcon />
              <span>{t('oauth.loopback')}</span>
            </p>
          ) : undefined}
        </>
      ) : (
        <ErrorAlert error={apiFailure(403, 'oauth/access_denied', 'access denied')} />
      )}
      {decide.isError ? <ErrorAlert error={decide.error} /> : undefined}
      <div className="oauth__actions">
        {consent.canAuthorize ? (
          <>
            <button
              type="button"
              className="button button--glass button--large"
              disabled={busy}
              onClick={() => decide.mutate('deny')}
            >
              {spinner('deny')}
              {t('common.cancel')}
            </button>
            <button
              type="button"
              className="button button--primary button--large"
              disabled={busy}
              onClick={() => decide.mutate('allow')}
            >
              {spinner('allow')}
              {t('oauth.allow')}
            </button>
          </>
        ) : (
          <button
            type="button"
            className="button button--glass button--large"
            disabled={busy}
            onClick={() => decide.mutate('deny')}
          >
            {spinner('deny')}
            {t('common.back')}
          </button>
        )}
      </div>
    </>
  )
}

const ConsentLoader = ({ query }: { query: OAuthAuthorizeQuery }) => {
  const consent = useQuery({
    queryKey: ['oauth', 'authorize', query],
    queryFn: () => request(() => api.oauth.authorize.$get({ query })),
    staleTime: Number.POSITIVE_INFINITY,
  })
  if (consent.isError) return <Failed error={consent.error} />
  if (consent.isPending)
    return (
      <div className="oauth__skeleton" aria-busy="true">
        <span className="skeleton skeleton--line oauth__skeleton-title" />
        <span className="skeleton skeleton--line" />
        <span className="skeleton skeleton--line" />
      </div>
    )
  return <Consent query={query} consent={consent.data} />
}

/**
 * `/oauth/authorize` (§27.3): an assistant (ChatGPT, a Claude connector) asks to act as the
 * active profile. Behind the login and "Who's watching?" (the route comes back here with the same
 * query). Shows the client, the host the code goes back to, a warning when that is this computer,
 * and the profile; "Autoriser" / "Annuler" post the decision and follow `redirectTo`. Without the
 * right (not an admin, restricted profile): the reason and "Retour", which declines. An invalid
 * request is shown, never sent back.
 */
export const OAuthAuthorizePage = () => {
  // Read once, from the address bar as it came: the router's search parsing retypes values.
  const [query] = useState(() => readAuthorizeQuery(window.location.search))
  return (
    <Screen>
      {query === undefined ? (
        <Failed error={apiFailure(400, 'oauth/invalid_request', 'invalid authorization request')} />
      ) : (
        <ConsentLoader query={query} />
      )}
    </Screen>
  )
}
