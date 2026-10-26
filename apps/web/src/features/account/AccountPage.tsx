import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { type FormEvent, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { MeResponse } from '@projo/shared/api/auth'
import { passwordSchema } from '@projo/shared/api/auth'
import { healthResponseSchema } from '@projo/shared/api/common'

import { api, request } from '../../shared/api/client.ts'
import { formatRelative } from '../../shared/format/format.ts'
import { currentLocale } from '../../shared/i18n/index.ts'
import { Field, RevealButton, ValidMark } from '../../shared/ui/controls.tsx'
import { LockIcon, ShieldIcon } from '../../shared/ui/icons.tsx'
import { DevicesIcon } from '../../shared/ui/media-icons.tsx'
import { ErrorAlert, ErrorState } from '../../shared/ui/states.tsx'
import { useNow } from '../../shared/ui/use-now.ts'
import { passwordScore } from '../setup/password-strength.ts'
import { ConnectDeviceDialog } from './ConnectDeviceDialog.tsx'
import '../profiles/profiles.css'
import './account.css'

const strengthKeys = ['empty', 'weak', 'fair', 'good', 'strong'] as const

/** `GET /auth/sessions`: the account's browsers and devices, most recent first (§14). */
const sessionsQuery = queryOptions({
  queryKey: ['sessions'],
  queryFn: () => request(() => api.auth.sessions.$get()),
})

/** `POST /auth/password`: the other sessions are revoked by the server. */
const PasswordPanel = () => {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const ids = useId()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [shown, setShown] = useState(false)
  const change = useMutation({
    mutationFn: () =>
      request(() =>
        api.auth.password.$post({ json: { currentPassword: current, newPassword: next } }),
      ),
    onSuccess: async () => {
      setCurrent('')
      setNext('')
      setConfirmation('')
      await queryClient.invalidateQueries({ queryKey: sessionsQuery.queryKey })
    },
  })
  const valid = passwordSchema.safeParse(next).success
  const matches = confirmation.length > 0 && confirmation === next
  const mismatch = !matches && confirmation.length > 0 && confirmation.length >= next.length
  const score = passwordScore(next)
  const ready = current.length > 0 && valid && matches
  const type = shown ? 'text' : 'password'

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (ready && !change.isPending) change.mutate()
  }

  return (
    <section className="settings-panel" aria-labelledby={`${ids}-title`}>
      <h2 id={`${ids}-title`} className="settings-panel__title">
        {t('account.password.title')}
      </h2>
      <form className="account-form" onSubmit={submit} noValidate>
        {change.isError ? <ErrorAlert error={change.error} /> : undefined}
        {change.isSuccess ? (
          <p className="alert alert--info" role="status">
            {t('account.password.done')}
          </p>
        ) : undefined}
        <Field
          id={`${ids}-current`}
          label={t('account.password.current')}
          icon={<LockIcon />}
          trail={<RevealButton shown={shown} onToggle={() => setShown(!shown)} />}
        >
          <input
            id={`${ids}-current`}
            className="field__input"
            type={type}
            autoComplete="current-password"
            value={current}
            onChange={(event) => setCurrent(event.target.value)}
          />
        </Field>
        <div className="form-row">
          <Field id={`${ids}-new`} label={t('account.password.new')} icon={<LockIcon />}>
            <input
              id={`${ids}-new`}
              className="field__input"
              type={type}
              autoComplete="new-password"
              value={next}
              aria-describedby={`${ids}-strength`}
              onChange={(event) => setNext(event.target.value)}
            />
          </Field>
          <div className="meter" aria-hidden="true">
            {[1, 2, 3, 4].map((level) => (
              <span key={level} className="meter__segment" data-on={score >= level} />
            ))}
          </div>
          <span id={`${ids}-strength`} className="hint" aria-live="polite">
            {t('setup.account.strength')}{' '}
            <strong>{t(`setup.strength.${strengthKeys[score]}`)}</strong>
            {valid ? undefined : ` · ${t('setup.account.passwordRule')}`}
          </span>
        </div>
        <div className="form-row">
          <Field
            id={`${ids}-confirmation`}
            label={t('account.password.confirmation')}
            icon={<ShieldIcon />}
            invalid={mismatch}
            trail={matches ? <ValidMark label={t('setup.account.matches')} /> : undefined}
          >
            <input
              id={`${ids}-confirmation`}
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
        <div className="account-form__actions">
          <button
            type="submit"
            className="button button--primary"
            disabled={!ready || change.isPending}
          >
            {change.isPending ? <span className="spinner" aria-hidden="true" /> : undefined}
            {t('account.password.submit')}
          </button>
        </div>
      </form>
    </section>
  )
}

/**
 * The account's devices, revocable one by one, and "Connect a device" (pairing, §14). Fixed
 * height: the list scrolls.
 */
const DevicesPanel = () => {
  const { t } = useTranslation()
  const ids = useId()
  const locale = currentLocale()
  const now = useNow()
  const queryClient = useQueryClient()
  const sessions = useQuery(sessionsQuery)
  const [connecting, setConnecting] = useState(false)
  const revoke = useMutation({
    mutationFn: (id: string) => request(() => api.auth.sessions[':id'].$delete({ param: { id } })),
    onSettled: () => queryClient.invalidateQueries({ queryKey: sessionsQuery.queryKey }),
  })
  return (
    <section className="settings-panel" aria-labelledby={`${ids}-title`}>
      <div className="devices__head">
        <h2 id={`${ids}-title`} className="settings-panel__title">
          {t('account.devices.title')}
        </h2>
        <button
          type="button"
          className="button button--glass button--small"
          onClick={() => setConnecting(true)}
        >
          {t('account.devices.connect')}
        </button>
      </div>
      <ConnectDeviceDialog
        open={connecting}
        onClose={() => setConnecting(false)}
        onDevicesChanged={() =>
          void queryClient.invalidateQueries({ queryKey: sessionsQuery.queryKey })
        }
      />
      {revoke.isError ? <ErrorAlert error={revoke.error} /> : undefined}
      <div className="devices" aria-busy={sessions.isPending}>
        {sessions.isError ? (
          <ErrorState error={sessions.error} onRetry={() => void sessions.refetch()} />
        ) : sessions.isPending ? (
          [0, 1, 2].map((index) => <span key={index} className="skeleton device--skeleton" />)
        ) : (
          <ul className="devices__list">
            {sessions.data.items.map((session) => (
              <li key={session.id} className="device">
                <span className="device__icon" aria-hidden="true">
                  <DevicesIcon size={20} />
                </span>
                <span className="device__text">
                  <span className="device__name">
                    {session.deviceName}
                    {session.current ? (
                      <span className="badge device__current">{t('account.devices.current')}</span>
                    ) : undefined}
                  </span>
                  <span className="device__meta">
                    {[
                      session.kind === 'bearer' ? t('account.devices.app') : undefined,
                      t('account.devices.lastSeen', {
                        when: formatRelative(session.lastSeenAt, locale, now),
                      }),
                    ]
                      .filter((part) => part !== undefined)
                      .join(' · ')}
                  </span>
                </span>
                {session.current ? undefined : (
                  <button
                    type="button"
                    className="button button--small button--danger"
                    disabled={revoke.isPending && revoke.variables === session.id}
                    aria-label={t('account.devices.revokeDevice', { name: session.deviceName })}
                    onClick={() => revoke.mutate(session.id)}
                  >
                    {t('account.devices.revoke')}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}

/** `/settings/account`: the account (§14), its password and its devices. */
/** `GET /health` (outside `/api/v1`): the app version. */
const healthQuery = queryOptions({
  queryKey: ['health'],
  queryFn: async () => healthResponseSchema.parse(await (await fetch('/health')).json()),
  staleTime: Number.POSITIVE_INFINITY,
})

/** "À propos": the version and the attributions the data sources require (§12.2). */
const AboutPanel = () => {
  const { t } = useTranslation()
  const ids = useId()
  const health = useQuery(healthQuery)
  return (
    <section className="settings-panel" aria-labelledby={`${ids}-title`}>
      <h2 id={`${ids}-title`} className="settings-panel__title">
        {t('account.about.title')}
      </h2>
      <dl className="about">
        <div className="about__row">
          <dt>{t('account.about.version')}</dt>
          <dd className="mono">{health.data?.version ?? '—'}</dd>
        </div>
      </dl>
      <p className="about__credits">{t('account.about.segmentsCredit')}</p>
    </section>
  )
}

export const AccountPage = ({ me }: { me: MeResponse }) => {
  const { t } = useTranslation()
  return (
    <div className="page page--narrow settings">
      <div className="settings__head">
        <div className="settings__who">
          <h1 className="page__title">{t('account.title')}</h1>
          <span className="account__username">
            {me.account.username} ·{' '}
            {me.account.role === 'admin' ? t('shell.roleAdmin') : t('shell.roleUser')}
          </span>
        </div>
      </div>
      <PasswordPanel />
      <DevicesPanel />
      <AboutPanel />
    </div>
  )
}
