import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { type FormEvent, useId } from 'react'
import { useTranslation } from 'react-i18next'

import {
  type ServerSettingsDto,
  serverNameSchema,
  type UpdateAdminSettingsBody,
} from '@projo/shared/api/settings'
import type { StorageDto } from '@projo/shared/api/system'
import { err, ok, type Result } from '@projo/shared/result'

import { api, request } from '../../../shared/api/client.ts'
import { formatBytes, formatRelative } from '../../../shared/format/format.ts'
import { currentLocale } from '../../../shared/i18n/index.ts'
import { setupStatusQuery } from '../../../shared/session/session.ts'
import { Field } from '../../../shared/ui/controls.tsx'
import { ErrorAlert, ErrorState } from '../../../shared/ui/states.tsx'
import { useNow } from '../../../shared/ui/use-now.ts'
import { DatabaseIcon, ServerIcon } from '../admin-icons.tsx'
import { SettingsSection } from '../admin-sections.tsx'
import { OptimizeImagesSetting } from '../metadata/OptimizeImages.tsx'
import { storageQuery } from '../operations/queries.ts'
import { settingsQuery } from './queries.ts'
import { SaveBar } from './SaveBar.tsx'
import { useSettingsForm } from './use-settings-form.ts'
import '../admin.css'
import '../admin-table.css'
import '../operations/operations.css'
import './settings.css'

type ServerDraft = { name: string }

const serverNameChanges = (
  draft: ServerDraft,
  changed: Partial<ServerDraft>,
): Result<UpdateAdminSettingsBody, readonly 'name'[]> => {
  const parsed = serverNameSchema.safeParse(draft.name)
  if (!parsed.success) return err(['name'])
  return ok(changed.name === undefined ? {} : { server: { name: parsed.data } })
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
          ? ' '
          : t('admin.server.measured', { when: formatRelative(storage.measuredAt, locale, now) })}
      </p>
    </div>
  )
}

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
            ? ' '
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

const ServerSettings = ({ server }: { server: ServerSettingsDto }) => {
  const { t } = useTranslation()
  const id = useId()
  const queryClient = useQueryClient()
  const form = useSettingsForm({
    saved: { name: server.name },
    changes: serverNameChanges,
    onSaved: () => void queryClient.invalidateQueries({ queryKey: setupStatusQuery.queryKey }),
  })
  const invalid = form.invalid.includes('name')
  const submit = (event: FormEvent) => {
    event.preventDefault()
    form.save()
  }
  return (
    <>
      <section className="settings-section" aria-label={t('admin.tabs.general')}>
        <form className="settings-block" onSubmit={submit} noValidate>
          <Field
            id={id}
            label={t('admin.server.name')}
            icon={<ServerIcon size={20} />}
            invalid={invalid}
          >
            <input
              id={id}
              className="field__input"
              value={form.draft.name}
              maxLength={64}
              autoComplete="off"
              aria-invalid={invalid}
              onChange={(event) => form.set('name', event.target.value)}
            />
          </Field>
        </form>
        <dl className="adm-details server-env">
          <dt>{t('admin.server.port')}</dt>
          <dd className="adm-mono">{server.port}</dd>
          <dt>{t('admin.server.trustProxy')}</dt>
          <dd className="adm-mono">{server.trustProxy ? 'true' : 'false'}</dd>
          <dt>{t('admin.server.dataDir')}</dt>
          <dd className="adm-mono adm-line adm-path" title={server.dataDir}>
            <bdi>{server.dataDir}</bdi>
          </dd>
        </dl>
      </section>
      <Maintenance />
      <SaveBar form={form} />
    </>
  )
}

const Maintenance = () => {
  const { t } = useTranslation()
  const storage = useQuery(storageQuery)
  return (
    <>
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
    </>
  )
}

/** Settings › General (§15): the server's name, what the environment sets, storage, upkeep. */
export const GeneralSettingsPage = () => {
  const settings = useQuery(settingsQuery)
  return (
    <SettingsSection>
      {settings.isError ? (
        <ErrorState error={settings.error} onRetry={() => void settings.refetch()} />
      ) : settings.data === undefined ? (
        <>
          <section className="settings-section" aria-hidden="true">
            <span className="skeleton settings-skeleton" />
          </section>
          <Maintenance />
        </>
      ) : (
        <ServerSettings server={settings.data.server} />
      )}
    </SettingsSection>
  )
}
