import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import type {
  AppVersionDto,
  ReleaseDto,
  UpdateRunDto,
  UpdatesStatusDto,
} from '@projo/shared/api/updates'
import { isErrorCode } from '@projo/shared/errors'

import { api, request } from '../../../shared/api/client.ts'
import {
  formatDate,
  formatDateTime,
  formatPercent,
  formatRelative,
} from '../../../shared/format/format.ts'
import { currentLocale } from '../../../shared/i18n/index.ts'
import { copyText } from '../../../shared/ui/copy-text.ts'
import { Dialog } from '../../../shared/ui/Dialog.tsx'
import { CheckIcon, SyncIcon } from '../../../shared/ui/icons.tsx'
import { EmptyState, ErrorAlert, ErrorState } from '../../../shared/ui/states.tsx'
import { useElement } from '../../../shared/ui/use-element.ts'
import { CopyIcon } from '../admin-icons.tsx'
import { updatesQuery, updatesQueryKey, useLiveUpdates } from './queries.ts'
import { parseInline, parseReleaseNotes } from './release-notes.ts'
import '../admin.css'
import '../accounts/accounts.css'
import './updates.css'

type Confirming = { kind: 'update' | 'rollback'; version: string }

const BUSY = new Set<UpdatesStatusDto['state']>(['downloading', 'applying', 'restarting'])

/** The translated message of a stored error (`code` known to the web, else its message). */
const useStoredError = () => {
  const { t } = useTranslation()
  return (error: { code: string; message: string }): string =>
    isErrorCode(error.code) ? t(`errors.${error.code}`) : error.message
}

/** Live line under the release: what the updater is doing (§16.4). */
const Progress = ({ status }: { status: UpdatesStatusDto }) => {
  const { t } = useTranslation()
  const locale = currentLocale()
  const { state, progress } = status
  if (state !== 'downloading' && state !== 'applying' && state !== 'restarting') return undefined
  const label =
    state === 'downloading'
      ? t('admin.updates.state.downloading', {
          percent: formatPercent((progress ?? 0) / 100, locale),
        })
      : t(`admin.updates.state.${state}`)
  return (
    <div className="upd-progress" role="status">
      <span className="upd-progress__label">
        <span className="spinner" aria-hidden="true" />
        {label}
      </span>
      <span className="bar-live">
        {state === 'downloading' ? (
          <progress className="bar" value={progress ?? 0} max={100} aria-label={label} />
        ) : (
          <progress className="bar" aria-label={label} />
        )}
      </span>
    </div>
  )
}

const PullCommand = ({ command }: { command: string }) => {
  const { t } = useTranslation()
  const [input, inputRef] = useElement<HTMLInputElement>()
  const [copied, setCopied] = useState<boolean>()
  return (
    <div className="upd-pull">
      <p className="upd-pull__text">{t('admin.updates.runtimeTooOld')}</p>
      <div className="upd-pull__row">
        {/* An input, not <code>: the plain-HTTP copy fallback selects a field. */}
        <input
          ref={inputRef}
          className="upd-pull__command"
          readOnly
          value={command}
          aria-label={t('admin.updates.runtimeTooOld')}
          onFocus={(event) => event.target.select()}
        />
        <button
          type="button"
          className="icon-button"
          aria-label={copied === true ? t('admin.updates.copied') : t('admin.updates.copy')}
          title={copied === true ? t('admin.updates.copied') : t('admin.updates.copy')}
          onClick={() => {
            void copyText(command, input).then(setCopied)
          }}
        >
          {copied === true ? <CheckIcon /> : <CopyIcon />}
        </button>
      </div>
      {copied === false ? (
        <p className="hint hint--error">{t('admin.updates.copyFailed')}</p>
      ) : undefined}
    </div>
  )
}

const Inline = ({ text }: { text: string }) =>
  parseInline(text).map((part, index) =>
    part.kind === 'code' ? (
      <code key={index}>{part.text}</code>
    ) : part.kind === 'link' ? (
      <a key={index} href={part.href} target="_blank" rel="noreferrer noopener">
        {part.href}
      </a>
    ) : (
      part.text
    ),
  )

const ReleaseNotes = ({ notes }: { notes: string }) => (
  <div className="upd-release__notes">
    {parseReleaseNotes(notes).map((block, index) =>
      block.kind === 'heading' ? (
        <h3 key={index}>
          <Inline text={block.text} />
        </h3>
      ) : block.kind === 'list' ? (
        <ul key={index}>
          {block.items.map((item, itemIndex) => (
            <li key={itemIndex}>
              <Inline text={item} />
            </li>
          ))}
        </ul>
      ) : (
        <p key={index}>
          <Inline text={block.text} />
        </p>
      ),
    )}
  </div>
)

/** The newer release (version, date, notes) and "Update", or "projo is up to date". */
const Release = ({
  status,
  onUpdate,
}: {
  status: UpdatesStatusDto
  onUpdate: (release: ReleaseDto) => void
}) => {
  const { t } = useTranslation()
  const locale = currentLocale()
  const { available } = status
  const busy = BUSY.has(status.state)
  if (available === undefined)
    return (
      <div className="upd-release upd-release--current">
        <p className="upd-release__uptodate">{t('admin.updates.upToDate')}</p>
        <Progress status={status} />
      </div>
    )
  return (
    <div className="upd-release">
      <div className="upd-release__head">
        <div className="upd-release__title">
          <span className="upd-release__version">{available.version}</span>
          <span className="upd-release__meta">
            {t('admin.updates.publishedAt', { date: formatDate(available.publishedAt, locale) })}
            {' · '}
            <a href={available.url} target="_blank" rel="noreferrer noopener">
              {t('admin.updates.releasePage')}
            </a>
          </span>
        </div>
        {available.runtimeCompatible ? (
          <button
            type="button"
            className="button button--primary"
            disabled={!status.enabled || busy}
            onClick={() => onUpdate(available)}
          >
            {t('admin.updates.update')}
          </button>
        ) : undefined}
      </div>
      <Progress status={status} />
      {/* Updater off (`bun run dev`): the runtime is not a version, the image is not the point. */}
      {!status.enabled ||
      available.runtimeCompatible ||
      available.pullCommand === undefined ? undefined : (
        <PullCommand command={available.pullCommand} />
      )}
      {available.notes.trim() === '' ? undefined : <ReleaseNotes notes={available.notes} />}
    </div>
  )
}

const VersionRow = ({
  version,
  disabled,
  onRollback,
}: {
  version: AppVersionDto
  disabled: boolean
  onRollback: () => void
}) => {
  const { t } = useTranslation()
  const locale = currentLocale()
  return (
    <div className="upd-tr upd-tr--versions" role="row">
      <span className="upd-tr__mono upd-tr__strong" role="cell">
        {version.version}
      </span>
      <span role="cell">
        <span className={version.state === 'failed' ? 'acc-pill acc-pill--off' : 'acc-pill'}>
          {t(`admin.updates.versionState.${version.state}`)}
        </span>
      </span>
      <span className="upd-tr__muted upd-tr__optional" role="cell">
        {formatDate(version.installedAt, locale)}
      </span>
      <span className="upd-tr__mono upd-tr__muted upd-tr__optional" role="cell">
        {version.runtimeMin}
      </span>
      <span className="upd-tr__action" role="cell">
        {version.canSwitch ? (
          <button
            type="button"
            className="button button--glass button--small"
            disabled={disabled}
            aria-label={t('admin.updates.rollbackNamed', { version: version.version })}
            onClick={onRollback}
          >
            {t('admin.updates.rollback')}
          </button>
        ) : undefined}
      </span>
    </div>
  )
}

const RunRow = ({ run }: { run: UpdateRunDto }) => {
  const { t } = useTranslation()
  const locale = currentLocale()
  const storedError = useStoredError()
  return (
    <div className="upd-tr upd-tr--runs" role="row">
      <span className="upd-tr__muted" role="cell">
        {formatDateTime(run.requestedAt, locale)}
      </span>
      <span role="cell">{t(`admin.updates.kind.${run.kind}`)}</span>
      <span className="upd-tr__mono" role="cell">
        {t('admin.updates.fromTo', { from: run.fromVersion, to: run.toVersion })}
      </span>
      <span className="upd-tr__outcome" role="cell">
        <span
          className={
            run.outcome === 'failed' || run.outcome === 'rolled_back'
              ? 'acc-pill acc-pill--off'
              : 'acc-pill'
          }
        >
          {t(`admin.updates.outcome.${run.outcome}`)}
        </span>
        {run.error === undefined ? undefined : (
          <span className="upd-tr__muted upd-tr__error" title={storedError(run.error)}>
            {storedError(run.error)}
          </span>
        )}
      </span>
    </div>
  )
}

const SkeletonRows = ({ count }: { count: number }) => (
  <>
    {Array.from({ length: count }, (_, index) => (
      <div key={index} className="upd-tr upd-tr--skeleton" aria-hidden="true">
        <span className="skeleton skeleton--line" />
      </div>
    ))}
  </>
)

const ConfirmDialog = ({
  confirming,
  from,
  onClose,
  onRestarting,
}: {
  confirming: Confirming
  from: string
  onClose: () => void
  onRestarting: (from: string) => void
}) => {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const run = useMutation({
    mutationFn: async (): Promise<void> => {
      const json = { version: confirming.version }
      if (confirming.kind === 'update') await request(() => api.admin.updates.apply.$post({ json }))
      else await request(() => api.admin.updates.rollback.$post({ json }))
    },
    onSuccess: () => {
      if (confirming.kind === 'rollback') onRestarting(from)
      void queryClient.invalidateQueries({ queryKey: updatesQueryKey })
      onClose()
    },
  })
  return (
    <Dialog
      open
      title={
        confirming.kind === 'update'
          ? t('admin.updates.confirmUpdate', { version: confirming.version })
          : t('admin.updates.confirmRollback', { version: confirming.version })
      }
      onClose={onClose}
      footer={
        <>
          <button type="button" className="button" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className="button button--primary"
            disabled={run.isPending}
            onClick={() => run.mutate()}
          >
            {run.isPending ? <span className="spinner" aria-hidden="true" /> : undefined}
            {confirming.kind === 'update' ? t('admin.updates.update') : t('admin.updates.rollback')}
          </button>
        </>
      }
    >
      <p className="dialog__text">{t('admin.updates.confirmText')}</p>
      {run.isError ? <ErrorAlert error={run.error} /> : undefined}
    </Dialog>
  )
}

/**
 * `/admin/updates` (§15 "Updates", §16.4): running version and last check, the newer release
 * with its notes and "Update", the versions on the disk with "Go back to this version",
 * the log. Live through `update.state`; during the switch the page waits for the server and
 * reloads.
 */
export const UpdatesPage = () => {
  const { t } = useTranslation()
  const locale = currentLocale()
  const queryClient = useQueryClient()
  const status = useQuery(updatesQuery)
  const { restarting, watchRestart } = useLiveUpdates()
  const storedError = useStoredError()
  const [confirming, setConfirming] = useState<Confirming | undefined>()
  const check = useMutation({
    mutationFn: () => request(() => api.admin.updates.check.$post()),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: updatesQueryKey }),
  })

  const data = status.data

  if (status.isError && data === undefined)
    return (
      <div className="admin-page">
        <ErrorState error={status.error} onRetry={() => void status.refetch()} />
      </div>
    )

  const busy = data !== undefined && (BUSY.has(data.state) || restarting)
  const checking = check.isPending || data?.state === 'checking'

  return (
    <div className="admin-page upd-page">
      <div className="admin-page__header">
        <h1 className="admin-page__title">{t('admin.updates.title')}</h1>
        <div className="admin-page__actions">
          <button
            type="button"
            className="button button--glass"
            disabled={data === undefined || !data.enabled || checking || busy}
            onClick={() => check.mutate()}
          >
            {checking ? <span className="spinner" aria-hidden="true" /> : <SyncIcon />}
            {checking ? t('admin.updates.state.checking') : t('admin.updates.check')}
          </button>
        </div>
      </div>

      {data !== undefined && !data.enabled ? (
        <p className="upd-notice">{t('errors.update/disabled')}</p>
      ) : undefined}
      {check.isError ? <ErrorAlert error={check.error} /> : undefined}

      <dl className="upd-summary">
        <div className="upd-summary__item">
          <dt>{t('admin.updates.current')}</dt>
          <dd>
            {data === undefined ? (
              <span className="skeleton skeleton--line upd-summary__skeleton" />
            ) : (
              <>
                <span className="upd-summary__value">{data.current.version}</span>
                <span className="upd-summary__sub">
                  {t('admin.updates.runtime', { version: data.current.runtime })}
                </span>
              </>
            )}
          </dd>
        </div>
        <div className="upd-summary__item">
          <dt>{t('admin.updates.lastCheck')}</dt>
          <dd>
            {data === undefined ? (
              <span className="skeleton skeleton--line upd-summary__skeleton" />
            ) : (
              <>
                <span
                  className="upd-summary__value upd-summary__value--text"
                  title={
                    data.lastCheckedAt === undefined
                      ? undefined
                      : formatDateTime(data.lastCheckedAt, locale)
                  }
                >
                  {data.lastCheckedAt === undefined
                    ? t('admin.updates.never')
                    : formatRelative(data.lastCheckedAt, locale)}
                </span>
                {data.lastCheckError === undefined ? (
                  <span className="upd-summary__sub">{' '}</span>
                ) : (
                  <span className="upd-summary__sub upd-summary__sub--error">
                    {storedError(data.lastCheckError)}
                  </span>
                )}
              </>
            )}
          </dd>
        </div>
      </dl>

      <section className="upd-section" aria-labelledby="upd-available">
        <h2 id="upd-available" className="admin-section__title">
          {t('admin.updates.available')}
        </h2>
        {data === undefined ? (
          <span className="skeleton upd-release__skeleton" aria-hidden="true" />
        ) : (
          <Release
            status={restarting ? { ...data, state: 'restarting' } : data}
            onUpdate={(release) => setConfirming({ kind: 'update', version: release.version })}
          />
        )}
      </section>

      <section className="upd-section" aria-labelledby="upd-versions">
        <h2 id="upd-versions" className="admin-section__title">
          {t('admin.updates.versions')}
        </h2>
        <div className="upd-table" role="table" aria-labelledby="upd-versions">
          <div className="upd-tr upd-tr--versions upd-tr--head" role="row">
            <span role="columnheader">{t('admin.updates.columns.version')}</span>
            <span role="columnheader">{t('admin.updates.columns.state')}</span>
            <span role="columnheader" className="upd-tr__optional">
              {t('admin.updates.columns.installedAt')}
            </span>
            <span role="columnheader" className="upd-tr__optional">
              {t('admin.updates.columns.runtimeMin')}
            </span>
            <span role="columnheader" />
          </div>
          <div className="upd-table__body upd-table__body--versions">
            {data === undefined ? <SkeletonRows count={2} /> : undefined}
            {data !== undefined && data.versions.length === 0 ? (
              <EmptyState title={t('admin.updates.versionsEmpty')} />
            ) : undefined}
            {data?.versions.map((version) => (
              <VersionRow
                key={version.version}
                version={version}
                disabled={!data.enabled || busy}
                onRollback={() => setConfirming({ kind: 'rollback', version: version.version })}
              />
            ))}
          </div>
        </div>
      </section>

      <section className="upd-section" aria-labelledby="upd-log">
        <h2 id="upd-log" className="admin-section__title">
          {t('admin.updates.log')}
        </h2>
        <div className="upd-table" role="table" aria-labelledby="upd-log">
          <div className="upd-tr upd-tr--runs upd-tr--head" role="row">
            <span role="columnheader">{t('admin.updates.columns.date')}</span>
            <span role="columnheader">{t('admin.updates.columns.kind')}</span>
            <span role="columnheader">{t('admin.updates.columns.versions')}</span>
            <span role="columnheader">{t('admin.updates.columns.outcome')}</span>
          </div>
          <div className="upd-table__body">
            {data === undefined ? <SkeletonRows count={3} /> : undefined}
            {data !== undefined && data.runs.length === 0 ? (
              <EmptyState title={t('admin.updates.logEmpty')} />
            ) : undefined}
            {data?.runs.map((run) => (
              <RunRow key={run.id} run={run} />
            ))}
          </div>
        </div>
      </section>

      {confirming === undefined || data === undefined ? undefined : (
        <ConfirmDialog
          confirming={confirming}
          from={data.current.version}
          onClose={() => setConfirming(undefined)}
          onRestarting={watchRestart}
        />
      )}
    </div>
  )
}
