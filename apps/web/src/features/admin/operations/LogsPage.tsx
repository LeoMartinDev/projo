import { useInfiniteQuery } from '@tanstack/react-query'
import { useEffect, useId, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { LogEntryDto, LogLevelDto } from '@projo/shared/api/logs'

import { currentLocale } from '../../../shared/i18n/index.ts'
import { Field } from '../../../shared/ui/controls.tsx'
import { SelectField } from '../../../shared/ui/Select.tsx'
import { Dialog } from '../../../shared/ui/Dialog.tsx'
import { SyncIcon } from '../../../shared/ui/icons.tsx'
import { EmptyState, ErrorState } from '../../../shared/ui/states.tsx'
import { Segmented } from '../../../shared/ui/Segmented.tsx'
import { DownloadIcon, SearchIcon } from '../admin-icons.tsx'
import {
  type LogFilterState,
  type LogLevelFilter,
  logLevelFilters,
  type LogPeriod,
  logPeriods,
  toLogFilters,
} from './log-filters.ts'
import { formatContext } from './stored-error.ts'
import { logsExportUrl, logsQuery } from './queries.ts'
import { AdminPageHeader } from '../AdminPageHeader.tsx'
import { SkeletonRows } from '../SkeletonRows.tsx'
import '../admin.css'
import '../accounts/accounts.css'
import '../admin-table.css'
import './operations.css'

const formatLogTime = (iso: string, locale: string): string =>
  new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'medium' }).format(new Date(iso))

/** Time of a row: day and month, then the time to the millisecond (lines often share a second). */
const formatRowTime = (iso: string, locale: string): string =>
  new Intl.DateTimeFormat(locale, {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    fractionalSecondDigits: 3,
    hourCycle: 'h23',
  }).format(new Date(iso))

const useDebounced = (value: string, delayMs: number): string => {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(timer)
  }, [value, delayMs])
  return debounced
}

const LevelTag = ({ level }: { level: LogLevelDto }) => {
  const { t } = useTranslation()
  return <span className={`log-level log-level--${level}`}>{t(`admin.logs.level.${level}`)}</span>
}

const textField = (entry: LogEntryDto, key: string): string | undefined => {
  const value = entry.fields[key]
  return typeof value === 'string' || typeof value === 'number' ? String(value) : undefined
}

/** What follows the message on its row: the code, and the request of an HTTP line. */
const detailOf = (entry: LogEntryDto): string => {
  const method = textField(entry, 'method')
  const path = textField(entry, 'path')
  const request =
    method === undefined || path === undefined
      ? undefined
      : [method, path, textField(entry, 'status')].filter(Boolean).join(' ')
  return [entry.code, request].filter((part) => part !== undefined).join(' · ')
}

const LogDetails = ({ entry, onClose }: { entry: LogEntryDto; onClose: () => void }) => {
  const { t } = useTranslation()
  const locale = currentLocale()
  return (
    <Dialog
      open
      title={t('admin.logs.line')}
      onClose={onClose}
      footer={
        <button type="button" className="button" onClick={onClose}>
          {t('common.close')}
        </button>
      }
    >
      <dl className="adm-details">
        <dt>{t('admin.logs.columns.time')}</dt>
        <dd className="adm-mono">{formatLogTime(entry.time, locale)}</dd>
        <dt>{t('admin.logs.columns.level')}</dt>
        <dd>
          <LevelTag level={entry.level} />
        </dd>
        {textField(entry, 'module') === undefined ? undefined : (
          <>
            <dt>{t('admin.logs.columns.module')}</dt>
            <dd className="adm-mono">{textField(entry, 'module')}</dd>
          </>
        )}
        <dt>{t('admin.logs.columns.message')}</dt>
        <dd>{entry.message}</dd>
        {entry.code === undefined ? undefined : (
          <>
            <dt>{t('admin.logs.code')}</dt>
            <dd className="adm-mono">{entry.code}</dd>
          </>
        )}
      </dl>
      {Object.keys(entry.fields).length === 0 ? undefined : (
        <pre className="adm-context log-fields">{formatContext(entry.fields)}</pre>
      )}
    </Dialog>
  )
}

const LogRow = ({ entry, onOpen }: { entry: LogEntryDto; onOpen: () => void }) => {
  const locale = currentLocale()
  const detail = detailOf(entry)
  return (
    <div className="adm-tr log-tr" role="row" data-level={entry.level}>
      <span className="log-tr__time" role="cell" title={formatLogTime(entry.time, locale)}>
        {formatRowTime(entry.time, locale)}
      </span>
      <span role="cell">
        <LevelTag level={entry.level} />
      </span>
      <span className="log-tr__module" role="cell">
        {textField(entry, 'module') ?? ''}
      </span>
      <span className="log-tr__line" role="cell">
        <button
          type="button"
          className="adm-open log-tr__message"
          aria-haspopup="dialog"
          onClick={onOpen}
        >
          {entry.message}
        </button>
        {detail === '' ? undefined : <span className="log-tr__detail">{detail}</span>}
      </span>
    </div>
  )
}

export const LogsPage = () => {
  const { t } = useTranslation()
  const periodId = useId()
  const searchId = useId()
  const fromId = useId()
  const toId = useId()
  const [state, setState] = useState<LogFilterState>(() => ({
    level: 'all',
    period: 'day',
    anchor: Date.now(),
    customFrom: '',
    customTo: '',
    text: '',
  }))
  const [opened, setOpened] = useState<LogEntryDto | undefined>()
  const text = useDebounced(state.text, 300)
  const filters = useMemo(() => toLogFilters({ ...state, text }), [state, text])
  const list = useInfiniteQuery(logsQuery(filters))
  const entries = list.data?.pages.flatMap((page) => page.items) ?? []
  const update = (patch: Partial<LogFilterState>) =>
    setState((current) => ({ ...current, ...patch }))
  const refresh = () => {
    if (state.period === 'custom' || state.period === 'all') void list.refetch()
    else update({ anchor: Date.now() })
  }

  return (
    <div className="admin-page">
      <AdminPageHeader
        title={t('admin.logs.title')}
        actions={
          <>
            <button
              type="button"
              className="button button--glass button--small"
              disabled={list.isFetching}
              onClick={refresh}
            >
              <SyncIcon size={16} />
              {t('admin.logs.refresh')}
            </button>
            <a
              className="button button--glass button--small"
              href={logsExportUrl(filters)}
              download
            >
              <DownloadIcon size={16} />
              {t('admin.logs.export')}
            </a>
          </>
        }
      />

      <div className="adm-toolbar">
        <Segmented<LogLevelFilter>
          role="toggle"
          label={t('admin.logs.levelLabel')}
          options={logLevelFilters.map((value) => ({
            value,
            label: t(`admin.logs.levelFilter.${value}`),
          }))}
          value={state.level}
          onChange={(level) => update({ level })}
        />
        <SelectField
          compact
          id={periodId}
          label={t('admin.logs.period')}
          value={state.period}
          options={logPeriods.map((value: LogPeriod) => ({
            value,
            label: t(`admin.logs.periods.${value}`),
          }))}
          onChange={(period) => update({ period, anchor: Date.now() })}
        />
        {state.period === 'custom' ? (
          <>
            <Field id={fromId} label={t('admin.logs.from')}>
              <input
                id={fromId}
                className="field__input"
                type="datetime-local"
                step={1}
                value={state.customFrom}
                onChange={(event) => update({ customFrom: event.target.value })}
              />
            </Field>
            <Field id={toId} label={t('admin.logs.to')}>
              <input
                id={toId}
                className="field__input"
                type="datetime-local"
                step={1}
                value={state.customTo}
                onChange={(event) => update({ customTo: event.target.value })}
              />
            </Field>
          </>
        ) : undefined}
        <Field id={searchId} label={t('admin.logs.search')} compact icon={<SearchIcon size={16} />}>
          <input
            id={searchId}
            className="field__input"
            type="search"
            maxLength={200}
            placeholder={t('admin.logs.searchPlaceholder')}
            value={state.text}
            onChange={(event) => update({ text: event.target.value })}
          />
        </Field>
      </div>

      <div className="adm-table adm-table--dense" role="table" aria-label={t('admin.logs.title')}>
        <div className="adm-tr log-tr adm-tr--head" role="row">
          <span role="columnheader">{t('admin.logs.columns.time')}</span>
          <span role="columnheader">{t('admin.logs.columns.level')}</span>
          <span role="columnheader">{t('admin.logs.columns.module')}</span>
          <span role="columnheader">{t('admin.logs.columns.message')}</span>
        </div>
        <div className="adm-table__body">
          {list.isPending ? <SkeletonRows count={12} /> : undefined}
          {list.isError && entries.length === 0 ? (
            <ErrorState error={list.error} onRetry={() => void list.refetch()} />
          ) : undefined}
          {list.isSuccess && entries.length === 0 ? (
            <EmptyState title={t('admin.logs.empty')} />
          ) : undefined}
          {entries.map((entry) => (
            <LogRow key={entry.id} entry={entry} onOpen={() => setOpened(entry)} />
          ))}
        </div>
      </div>

      {list.hasNextPage ? (
        <button
          type="button"
          className="button button--glass button--small adm-more"
          disabled={list.isFetchingNextPage}
          onClick={() => void list.fetchNextPage()}
        >
          {list.isFetchingNextPage ? <span className="spinner" aria-hidden="true" /> : undefined}
          {t('admin.review.more')}
        </button>
      ) : undefined}

      {opened === undefined ? undefined : (
        <LogDetails key={opened.id} entry={opened} onClose={() => setOpened(undefined)} />
      )}
    </div>
  )
}
