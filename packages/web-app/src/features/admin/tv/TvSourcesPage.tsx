import { useQuery } from '@tanstack/react-query'
import { type FormEvent, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { type AdminTvSourceDto, type TvSourceKind, tvSourceKinds } from '@projo/shared/api/tv'
import { isErrorCode } from '@projo/shared/errors'

import { formatDateTime, formatNumber, formatRelative } from '../../../shared/format/format.ts'
import { currentLocale } from '../../../shared/i18n/index.ts'
import { Dialog } from '../../../shared/ui/Dialog.tsx'
import { AlertIcon, PlusIcon } from '../../../shared/ui/icons.tsx'
import { SelectField } from '../../../shared/ui/Select.tsx'
import { EmptyState, ErrorAlert, ErrorState } from '../../../shared/ui/states.tsx'
import { useNow } from '../../../shared/ui/use-now.ts'
import { MediaSection } from '../admin-sections.tsx'
import { SkeletonRows } from '../SkeletonRows.tsx'
import { tvSourcesQuery, useCreateTvSource, useLiveTv } from './queries.ts'
import {
  emptySourceForm,
  invalidSourceFields,
  type SourceForm,
  toCreateBody,
} from './source-form.ts'
import { SourceFields } from './SourceFields.tsx'
import { TvSourceDialog } from './TvSourceDialog.tsx'
import '../admin.css'
import '../admin-table.css'
import '../accounts/accounts.css'
import '../library-status.css'
import './tv.css'

export const TvSourceState = ({ source }: { source: AdminTvSourceDto }) => {
  const { t } = useTranslation()
  switch (source.state) {
    case 'error': {
      const code = source.lastError?.code
      return (
        <div className="lib-status">
          <span className="lib-status__line lib-status__line--error">
            <AlertIcon size={15} />
            {t('admin.tv.state.error')}
          </span>
          {code === undefined ? undefined : (
            <span className="lib-status__detail">
              {isErrorCode(code) ? t(`errors.${code}`) : (source.lastError?.message ?? code)}
            </span>
          )}
        </div>
      )
    }
    case 'refreshing':
      return (
        <div className="lib-status" role="status">
          <span className="lib-status__line lib-status__line--strong">
            <span className="dot dot--busy" aria-hidden="true" />
            {t('admin.tv.state.refreshing')}
          </span>
        </div>
      )
    case 'ready':
    case 'pending':
      return (
        <div className="lib-status">
          <span className="lib-status__line">
            <span className={source.state === 'ready' ? 'dot dot--ok' : 'dot'} aria-hidden="true" />
            {t(`admin.tv.state.${source.state}`)}
          </span>
        </div>
      )
  }
}

const AddSourceDialog = ({ onClose }: { onClose: () => void }) => {
  const { t } = useTranslation()
  const id = useId()
  const create = useCreateTvSource()
  const [form, setForm] = useState<SourceForm>(emptySourceForm)
  const [submitted, setSubmitted] = useState(false)
  const invalid = invalidSourceFields(form, { creating: true })

  const change = (patch: Partial<SourceForm>) => {
    setForm((current) => ({ ...current, ...patch }))
    if (create.isError) create.reset()
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    setSubmitted(true)
    if (invalid.size > 0 || create.isPending) return
    create.mutate(toCreateBody(form), { onSuccess: onClose })
  }

  return (
    <Dialog
      open
      title={t('admin.tv.addTitle')}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="button" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button
            type="submit"
            form={`${id}-form`}
            className="button button--primary"
            disabled={create.isPending}
          >
            {create.isPending ? <span className="spinner" aria-hidden="true" /> : undefined}
            {t('admin.tv.form.create')}
          </button>
        </>
      }
    >
      <form id={`${id}-form`} className="tv-form" onSubmit={submit} noValidate>
        <SourceFields
          idPrefix={id}
          form={form}
          invalid={submitted ? invalid : new Set()}
          onChange={change}
          reserveKinds
          kindField={
            <SelectField<TvSourceKind>
              id={`${id}-kind`}
              label={t('admin.tv.form.kind')}
              value={form.kind}
              options={tvSourceKinds.map((value) => ({
                value,
                label: t(`admin.tv.kind.${value}`),
              }))}
              onChange={(kind) => change({ kind })}
            />
          }
          autoFocus
        />
        {create.isError ? <ErrorAlert error={create.error} /> : undefined}
      </form>
    </Dialog>
  )
}

const SourceRow = ({ source, onOpen }: { source: AdminTvSourceDto; onOpen: () => void }) => {
  const { t } = useTranslation()
  const locale = currentLocale()
  const now = useNow()
  return (
    <div className="adm-tr tv-tr" role="row">
      <div className="adm-cell" role="cell">
        <button type="button" className="adm-open" aria-haspopup="dialog" onClick={onOpen}>
          {source.name}
        </button>
      </div>
      <div className="adm-cell adm-optional" role="cell">
        <span className="acc-pill tv-tr__kind">{t(`admin.tv.kind.${source.kind}`)}</span>
      </div>
      <div className="adm-cell" role="cell">
        <span className="tv-tr__count">
          {t('admin.tv.enabledOf', {
            enabled: formatNumber(source.enabledChannelCount, locale),
            total: formatNumber(source.channelCount, locale),
          })}
        </span>
      </div>
      <div className="adm-cell adm-optional" role="cell">
        <span
          className="adm-muted"
          {...(source.lastRefreshAt === undefined
            ? {}
            : { title: formatDateTime(source.lastRefreshAt, locale) })}
        >
          {source.lastRefreshAt === undefined
            ? '—'
            : formatRelative(source.lastRefreshAt, locale, now)}
        </span>
      </div>
      <div className="adm-cell" role="cell">
        <TvSourceState source={source} />
      </div>
    </div>
  )
}

export const TvSourcesPage = () => {
  const { t } = useTranslation()
  const sources = useQuery(tvSourcesQuery)
  const [adding, setAdding] = useState(false)
  const [openedId, setOpenedId] = useState<string>()
  useLiveTv()
  const items = sources.data?.items ?? []
  const opened = items.find((source) => source.id === openedId)

  const addButton = (
    <button
      type="button"
      className="button button--primary button--small"
      onClick={() => setAdding(true)}
    >
      <PlusIcon />
      {t('admin.tv.add')}
    </button>
  )

  return (
    <MediaSection actions={addButton}>
      <div className="adm-table" role="table" aria-label={t('admin.tv.list')}>
        <div className="adm-tr tv-tr adm-tr--head" role="row">
          <span role="columnheader">{t('admin.tv.columns.name')}</span>
          <span role="columnheader" className="adm-optional">
            {t('admin.tv.columns.kind')}
          </span>
          <span role="columnheader">{t('admin.tv.columns.channels')}</span>
          <span role="columnheader" className="adm-optional">
            {t('admin.tv.columns.lastRefresh')}
          </span>
          <span role="columnheader">{t('admin.tv.columns.state')}</span>
        </div>
        <div className="adm-table__body">
          {sources.isPending ? <SkeletonRows count={3} /> : undefined}
          {sources.isError ? (
            <ErrorState error={sources.error} onRetry={() => void sources.refetch()} />
          ) : undefined}
          {sources.isSuccess && items.length === 0 ? (
            <EmptyState compact title={t('admin.tv.empty')} />
          ) : undefined}
          {items.map((source) => (
            <SourceRow key={source.id} source={source} onOpen={() => setOpenedId(source.id)} />
          ))}
        </div>
      </div>

      {adding ? <AddSourceDialog onClose={() => setAdding(false)} /> : undefined}
      {opened === undefined ? undefined : (
        <TvSourceDialog key={opened.id} source={opened} onClose={() => setOpenedId(undefined)} />
      )}
    </MediaSection>
  )
}
