import { type FormEvent, useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { EntryFrame, Field } from '@projo/web-app/desktop/EntryFrame.tsx'

import type { ConnectServer } from './connect-server.ts'
import { minimumServerVersion } from './server-version.ts'
import {
  type AttemptSource,
  type EntryScreen,
  type EntryStep,
  type ReadyServer,
  stepAfter,
} from './entry-flow.ts'
import './entry.css'

const ServerIcon = () => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <rect x="3" y="4" width="18" height="7" rx="2" />
    <rect x="3" y="13" width="18" height="7" rx="2" />
    <path d="M7 7.5h.01M7 16.5h.01" />
  </svg>
)

const useErrorText = () => {
  const { t } = useTranslation()
  return (code: string): string => {
    switch (code) {
      case 'server/invalid_url':
        return t('mobile.errors.connection/invalid_url')
      case 'server/not_projo':
        return t('mobile.errors.connection/not_projo')
      case 'server/unreachable':
        return t('desktop.errors.server/unreachable')
      case 'desktop/config_not_saved':
        return t('desktop.errors.desktop/config_not_saved')
      default:
        return t('errors.unknown')
    }
  }
}

const Spinner = ({ busy }: { busy: boolean }) =>
  busy ? <span className="spinner" aria-hidden="true" /> : undefined

const AddressScreen = ({
  serverUrl,
  error,
  busy,
  onConnect,
}: {
  serverUrl: string
  error: string | undefined
  busy: boolean
  onConnect: (url: string) => void
}) => {
  const { t } = useTranslation()
  const errorText = useErrorText()
  const [url, setUrl] = useState(serverUrl)
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!busy && url.trim() !== '') onConnect(url.trim())
  }
  return (
    <EntryFrame title={t('mobile.connect.title')} onSubmit={submit}>
      {error === undefined ? undefined : (
        <p className="alert" role="alert">
          {errorText(error)}
        </p>
      )}
      <Field
        id="server-url"
        label={t('mobile.connect.urlLabel')}
        icon={<ServerIcon />}
        invalid={error !== undefined}
      >
        <input
          id="server-url"
          className="field__input"
          name="url"
          type="text"
          inputMode="url"
          autoComplete="url"
          autoCapitalize="none"
          spellCheck={false}
          placeholder={t('mobile.connect.urlPlaceholder')}
          autoFocus
          disabled={busy}
          value={url}
          onChange={(event) => setUrl(event.target.value)}
        />
      </Field>
      <button
        type="submit"
        className="button button--primary button--large auth__submit"
        disabled={busy || url.trim() === ''}
      >
        <Spinner busy={busy} />
        {t('mobile.connect.submit')}
      </button>
    </EntryFrame>
  )
}

const ServerAddress = ({ serverUrl }: { serverUrl: string }) => (
  <p className="well entry__server">{serverUrl}</p>
)

const ChangeServer = ({ busy, onChange }: { busy: boolean; onChange: () => void }) => {
  const { t } = useTranslation()
  return (
    <button type="button" className="button button--large" disabled={busy} onClick={onChange}>
      {t('mobile.changeServer')}
    </button>
  )
}

const SavedServerScreen = ({
  screen,
  busy,
  onRetry,
  onChange,
}: {
  screen: Extract<EntryScreen, { kind: 'unreachable' | 'outdated' | 'not_set_up' }>
  busy: boolean
  onRetry: () => void
  onChange: () => void
}) => {
  const { t } = useTranslation()
  const retry = (label: string) => (
    <button
      type="button"
      className={`button button--large${screen.kind === 'not_set_up' ? '' : ' button--primary'}`}
      disabled={busy}
      onClick={onRetry}
    >
      <Spinner busy={busy} />
      {label}
    </button>
  )
  switch (screen.kind) {
    case 'unreachable':
      return (
        <EntryFrame title={t('desktop.unreachable.title')}>
          <ServerAddress serverUrl={screen.serverUrl} />
          {retry(t('desktop.unreachable.retry'))}
          <ChangeServer busy={busy} onChange={onChange} />
        </EntryFrame>
      )
    case 'outdated':
      return (
        <EntryFrame title={t('mobile.outdated.title')}>
          <p className="entry__text">
            {t('mobile.outdated.body', {
              minimumVersion: minimumServerVersion,
              version: screen.version,
            })}
          </p>
          <ServerAddress serverUrl={screen.serverUrl} />
          {retry(t('mobile.outdated.checkAgain'))}
          <ChangeServer busy={busy} onChange={onChange} />
        </EntryFrame>
      )
    case 'not_set_up':
      return (
        <EntryFrame title={t('desktop.setup.title')}>
          <ServerAddress serverUrl={screen.serverUrl} />
          {/* Setup runs in the browser (§3): the window opens it there (on_new_window). */}
          <a
            className="button button--primary button--large"
            href={`${screen.serverUrl}/setup`}
            target="_blank"
            rel="noreferrer"
          >
            {t('desktop.setup.open')}
          </a>
          {retry(t('mobile.outdated.checkAgain'))}
          <ChangeServer busy={busy} onChange={onChange} />
        </EntryFrame>
      )
  }
}

/**
 * The screens before the app (§28.3): the server's address, then the saved server's state
 * (unreachable, too old, not set up), until a server is ready: `onReady` mounts the app on it.
 * `start`: the first screen, or the saved server to connect to (`startingStep`). `onShown`: a
 * screen other than the blank start is drawn (the splash can go).
 */
export const Entry = ({
  start,
  connect,
  onReady,
  onShown,
}: {
  start: { connect: string } | EntryScreen
  connect: ConnectServer
  onReady: (server: ReadyServer) => void
  onShown: () => void
}) => {
  const [screen, setScreen] = useState<EntryScreen>(
    'connect' in start ? { kind: 'starting' } : start,
  )
  const [busy, setBusy] = useState(false)

  const show = useCallback(
    (step: EntryStep) => {
      if (step.kind === 'ready') onReady(step)
      else setScreen(step)
    },
    [onReady],
  )

  useEffect(() => {
    if (screen.kind !== 'starting') onShown()
  }, [screen.kind, onShown])

  // Launch with a saved server: straight to it.
  useEffect(() => {
    if (!('connect' in start)) return undefined
    let active = true
    void connect(start.connect).then((result) => {
      if (active) show(stepAfter(start.connect, 'saved', result))
    })
    return () => {
      active = false
    }
  }, [start, connect, show])

  // A server ready keeps the screen busy while the app mounts under it.
  const attempt = (url: string, source: AttemptSource) => {
    setBusy(true)
    void connect(url).then((result) => {
      const step = stepAfter(url, source, result)
      if (step.kind !== 'ready') setBusy(false)
      show(step)
    })
  }

  switch (screen.kind) {
    case 'starting':
      return <div className="entry__starting" />
    case 'address':
      return (
        <AddressScreen
          key={`${screen.serverUrl}:${screen.error ?? ''}`}
          serverUrl={screen.serverUrl}
          error={screen.error}
          busy={busy}
          onConnect={(url) => attempt(url, 'typed')}
        />
      )
    default:
      return (
        <SavedServerScreen
          screen={screen}
          busy={busy}
          onRetry={() => attempt(screen.serverUrl, 'saved')}
          onChange={() => setScreen({ kind: 'address', serverUrl: screen.serverUrl })}
        />
      )
  }
}
