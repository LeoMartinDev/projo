import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { type FormEvent, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { serverNameSchema } from '@projo/shared/api/settings'
import type { StorageDto } from '@projo/shared/api/system'

import { api, request } from '../../../shared/api/client.ts'
import { formatBytes, formatRelative } from '../../../shared/format/format.ts'
import { currentLocale } from '../../../shared/i18n/index.ts'
import { setupStatusQuery } from '../../../shared/session/session.ts'
import { Field } from '../../../shared/ui/controls.tsx'
import { ErrorAlert, ErrorState } from '../../../shared/ui/states.tsx'
import { useNow } from '../../../shared/ui/use-now.ts'
import { DatabaseIcon, ServerIcon } from '../admin-icons.tsx'
import { OptimizeImagesSetting } from '../metadata/RefreshLibrary.tsx'
import { storageQuery } from '../operations/queries.ts'
import { settingsQuery, useUpdateSettings } from './queries.ts'
import '../admin.css'
import '../admin-table.css'
import '../operations/operations.css'
import './settings.css'

/** "Nom" (§15 "Server"): shown on the login and invitation pages. */
const ServerName = ({ name }: { name: string }) => {
  const { t } = useTranslation()
  const id = useId()
  const queryClient = useQueryClient()
  const update = useUpdateSettings()
  const [draft, setDraft] = useState(name)
  const parsed = serverNameSchema.safeParse(draft)
  const dirty = parsed.success && parsed.data !== name

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!dirty || update.isPending) return
    update.mutate(
      { server: { name: parsed.data } },
      {
        onSuccess: () =>
          void queryClient.invalidateQueries({ queryKey: setupStatusQuery.queryKey }),
      },
    )
  }

  return (
    <div className="settings-block">
      <form className="server-name" onSubmit={submit} noValidate>
        <Field
          id={id}
          label={t('admin.server.name')}
          icon={<ServerIcon size={20} />}
          invalid={!parsed.success}
        >
          <input
            id={id}
            className="field__input"
            value={draft}
            maxLength={64}
            autoComplete="off"
            aria-invalid={!parsed.success}
            onChange={(event) => {
              setDraft(event.target.value)
              if (update.isError || update.isSuccess) update.reset()
            }}
          />
        </Field>
        <button
          type="submit"
          className="button button--primary"
          disabled={!dirty || update.isPending}
        >
          {update.isPending ? <span className="spinner" aria-hidden="true" /> : undefined}
          {t('common.save')}
        </button>
      </form>
      {update.isError ? <ErrorAlert error={update.error} /> : undefined}
    </div>
  )
}

const Storage = ({ storage }: { storage: StorageDto | undefined }) => {
  const { t } = useTranslation()
  const locale = currentLocale()
  const now = useNow()
  const used = storage?.categories.reduce((total, entry) => total + entry.bytes, 0)
  return (
    <div className="adm-table server-storage" role="table" aria-label={t('admin.server.storage')}>
      <div className="adm-tr storage-tr adm-tr--head" role="row">
        <span role="columnheader">{t('admin.server.category')}</span>
        <span role="columnheader" className="storage-tr__size">
          {t('admin.server.size')}
        </span>
      </div>
      {storage === undefined
        ? [0, 1, 2, 3, 4].map((index) => (
            <div key={index} className="adm-tr adm-tr--skeleton storage-tr" aria-hidden="true">
              <span className="skeleton skeleton--line" />
            </div>
          ))
        : storage.categories.map((entry) => (
            <div key={entry.category} className="adm-tr storage-tr" role="row">
              <span role="cell">{t(`admin.server.categories.${entry.category}`)}</span>
              <span role="cell" className="adm-mono storage-tr__size">
                {formatBytes(entry.bytes, locale)}
              </span>
            </div>
          ))}
      <div className="adm-tr storage-tr storage-tr--total" role="row">
        <span role="cell">{t('admin.server.used')}</span>
        <span role="cell" className="adm-mono storage-tr__size">
          {used === undefined ? '—' : formatBytes(used, locale)}
        </span>
      </div>
      {storage?.freeBytes === undefined || storage.totalBytes === undefined ? undefined : (
        <div className="adm-tr storage-tr" role="row">
          <span role="cell">{t('admin.server.free')}</span>
          <span role="cell" className="adm-mono storage-tr__size">
            {t('admin.server.freeOf', {
              free: formatBytes(storage.freeBytes, locale),
              total: formatBytes(storage.totalBytes, locale),
            })}
          </span>
        </div>
      )}
      <p className="adm-muted server-storage__measured">
        {storage === undefined
          ? '\u00a0'
          : t('admin.server.measured', { when: formatRelative(storage.measuredAt, locale, now) })}
      </p>
    </div>
  )
}

/** "Exporter la base" (§5.4): `VACUUM INTO db/backups/`, the file written shown under. */
const ExportDatabase = () => {
  const { t } = useTranslation()
  const locale = currentLocale()
  const exportDb = useMutation({
    mutationFn: () => request(() => api.admin.db.export.$post()),
  })
  return (
    <div className="settings-block">
      <div className="server-export">
        <button
          type="button"
          className="button button--glass"
          disabled={exportDb.isPending}
          onClick={() => exportDb.mutate()}
        >
          {exportDb.isPending ? <span className="spinner" aria-hidden="true" /> : <DatabaseIcon />}
          {t('admin.server.export')}
        </button>
        <span className="server-export__result adm-muted adm-mono" title={exportDb.data?.path}>
          {exportDb.data === undefined
            ? '\u00a0'
            : t('admin.server.exported', {
                file: exportDb.data.file,
                size: formatBytes(exportDb.data.sizeBytes, locale),
              })}
        </span>
      </div>
      {exportDb.isError ? <ErrorAlert error={exportDb.error} /> : undefined}
    </div>
  )
}

/**
 * `/admin/server` (§15 "Server"): the name; port, `TRUST_PROXY` and the data folder read-only
 * (environment variables, §5.4); space used under it by category; maintenance: "Exporter la
 * base", "Optimiser les images".
 */
export const ServerPage = () => {
  const { t } = useTranslation()
  const settings = useQuery(settingsQuery)
  const storage = useQuery(storageQuery)
  const server = settings.data?.server

  return (
    <div className="admin-page">
      <div className="admin-page__header">
        <h1 className="admin-page__title">{t('admin.server.title')}</h1>
      </div>

      {settings.isError ? (
        <ErrorState error={settings.error} onRetry={() => void settings.refetch()} />
      ) : (
        <section className="settings-section" aria-label={t('admin.server.title')}>
          {server === undefined ? (
            <span className="skeleton settings-skeleton" aria-hidden="true" />
          ) : (
            <ServerName key={server.name} name={server.name} />
          )}
          <dl className="adm-details server-env">
            <dt>{t('admin.server.port')}</dt>
            <dd className="adm-mono">{server === undefined ? '—' : server.port}</dd>
            <dt>{t('admin.server.trustProxy')}</dt>
            <dd className="adm-mono">
              {server === undefined ? '—' : server.trustProxy ? 'true' : 'false'}
            </dd>
            <dt>{t('admin.server.dataDir')}</dt>
            <dd className="adm-mono adm-line adm-path" title={server?.dataDir}>
              <bdi>{server?.dataDir ?? '—'}</bdi>
            </dd>
          </dl>
        </section>
      )}

      <section className="settings-section" aria-labelledby="server-storage">
        <h2 id="server-storage" className="admin-section__title">
          {t('admin.server.storage')}
        </h2>
        {storage.isError && storage.data === undefined ? (
          <ErrorState error={storage.error} onRetry={() => void storage.refetch()} />
        ) : (
          <Storage storage={storage.data} />
        )}
      </section>

      <section className="settings-section" aria-labelledby="server-maintenance">
        <h2 id="server-maintenance" className="admin-section__title">
          {t('admin.server.maintenance')}
        </h2>
        <ExportDatabase />
        <OptimizeImagesSetting />
      </section>
    </div>
  )
}
