import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { type FormEvent, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { MeResponse } from '@projo/shared/api/auth'
import { healthResponseSchema } from '@projo/shared/api/common'

import { api, request } from '../../shared/api/client.ts'
import { formatRelative } from '../../shared/format/format.ts'
import { currentLocale } from '../../shared/i18n/index.ts'
import { Field, RevealButton } from '../../shared/ui/controls.tsx'
import { LockIcon } from '../../shared/ui/icons.tsx'
import { DevicesIcon } from '../../shared/ui/media-icons.tsx'
import { ErrorAlert, ErrorState } from '../../shared/ui/states.tsx'
import { useNow } from '../../shared/ui/use-now.ts'
import { SettingsPanel } from '../../shared/ui/SettingsPanel.tsx'
import { SettingsPage } from '../../shared/ui/SettingsPage.tsx'
import { NewPasswordFields, usePasswordPair } from '../setup/NewPasswordFields.tsx'
import { ConnectDeviceDialog } from './ConnectDeviceDialog.tsx'
import './account.css'

const sessionsQuery = queryOptions({
  queryKey: ['sessions'],
  queryFn: () => request(() => api.auth.sessions.$get()),
})

const PasswordPanel = () => {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const ids = useId()
  const [current, setCurrent] = useState('')
  const pair = usePasswordPair()
  const [shown, setShown] = useState(false)
  const change = useMutation({
    mutationFn: () =>
      request(() =>
        api.auth.password.$post({
          json: { currentPassword: current, newPassword: pair.password },
        }),
      ),
    onSuccess: async () => {
      setCurrent('')
      pair.clear()
      await queryClient.invalidateQueries({ queryKey: sessionsQuery.queryKey })
    },
  })
  const ready = current.length > 0 && pair.ready
  const type = shown ? 'text' : 'password'

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (ready && !change.isPending) change.mutate()
  }

  return (
    <SettingsPanel title={t('account.password.title')}>
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
        <NewPasswordFields
          id={ids}
          pair={pair}
          shown={shown}
          labels={{
            password: t('account.password.new'),
            confirmation: t('account.password.confirmation'),
          }}
        />
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
    </SettingsPanel>
  )
}

const DevicesPanel = () => {
  const { t } = useTranslation()
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
    <SettingsPanel
      title={t('account.devices.title')}
      action={
        <button
          type="button"
          className="button button--glass button--small"
          onClick={() => setConnecting(true)}
        >
          {t('account.devices.connect')}
        </button>
      }
    >
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
    </SettingsPanel>
  )
}

const healthQuery = queryOptions({
  queryKey: ['health'],
  queryFn: async () => healthResponseSchema.parse(await (await fetch('/health')).json()),
  staleTime: Number.POSITIVE_INFINITY,
})

const AboutPanel = () => {
  const { t } = useTranslation()
  const health = useQuery(healthQuery)
  return (
    <SettingsPanel title={t('account.about.title')}>
      <dl className="about">
        <div className="about__row">
          <dt>{t('account.about.version')}</dt>
          <dd className="mono">{health.data?.version ?? '—'}</dd>
        </div>
      </dl>
      <p className="about__credits">{t('account.about.segmentsCredit')}</p>
    </SettingsPanel>
  )
}

export const AccountPage = ({ me }: { me: MeResponse }) => {
  const { t } = useTranslation()
  return (
    <SettingsPage
      title={t('account.title')}
      subtitle={`${me.account.username} · ${me.account.role === 'admin' ? t('shell.roleAdmin') : t('shell.roleUser')}`}
    >
      <PasswordPanel />
      <DevicesPanel />
      <AboutPanel />
    </SettingsPage>
  )
}
