import { useInfiniteQuery } from '@tanstack/react-query'
import { useEffect, useId, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { LogEntryDto, LogLevelDto } from '@projo/shared/api/logs'

import { currentLocale } from '../../../shared/i18n/index.ts'
import { Field, SelectChevron } from '../../../shared/ui/controls.tsx'
import { Dialog } from '../../../shared/ui/Dialog.tsx'
import { SyncIcon } from '../../../shared/ui/icons.tsx'
import { EmptyState, ErrorState } from '../../../shared/ui/states.tsx'
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
import '../admin.css'
import '../accounts/accounts.css'
import '../admin-table.css'
import './operations.css'

const formatLogTime = (iso: string, locale: string): string =>
  new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'medium' }).format(new Date(iso))

const useDebounced = (value: string, delayMs: number): string => {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(timer)
  }, [value, delayMs])
  return debounced
}

const LevelPill = ({ level }: { level: LogLevelDto }) => {
  const { t } = useTranslation()
  return (
    <span className={`acc-pill log-pill log-pill--${level}`}>{t(`admin.logs.level.${level}`)}</span>
  )
}

const textField = (entry: LogEntryDto, key: string): string | undefined => {
  const value = entry.fields[key]
  return typeof value === 'string' || typeof value === 'number' ? String(value) : undefined
}

/** The second line of a row: code, module, and the request of an HTTP line. */
const detailOf = (entry: LogEntryDto): string => {
  const method = textField(entry, 'method')
  const path = textField(entry, 'path')
  const request =
    method === undefined || path === undefined
      ? undefined
      : [method, path, textField(entry, 'status')].filter(Boolean).join(' ')
  return [entry.code, textField(entry, 'module'), request]
    .filter((part) => part !== undefined)
    .join(' · ')
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
          <LevelPill level={entry.level} />
        </dd>
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
      <div className="adm-cell log-tr__time" role="cell">
        <span className="adm-mono adm-muted">{formatLogTime(entry.time, locale)}</span>
      </div>
      <div className="adm-cell" role="cell">
        <LevelPill level={entry.level} />
      </div>
      <div className="adm-cell" role="cell">
        <button
          type="button"
          className="adm-open log-tr__message"
          aria-haspopup="dialog"
          onClick={onOpen}
        >
          {entry.message}
        </button>
        <span className="adm-muted adm-mono log-tr__detail">{detail === '' ? ' ' : detail}</span>
      </div>
    </div>
  )
}

const SkeletonRows = () => (
  <>
    {[0, 1, 2, 3, 4, 5].map((index) => (
      <div key={index} className="adm-tr adm-tr--skeleton" aria-hidden="true">
        <span className="skeleton skeleton--line" />
      </div>
    ))}
  </>
)

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
      <div className="admin-page__header">
        <h1 className="admin-page__title">{t('admin.logs.title')}</h1>
        <div className="admin-page__actions">
          <button
            type="button"
            className="button button--glass button--small"
            disabled={list.isFetching}
            onClick={refresh}
          >
            <SyncIcon size={16} />
            {t('admin.logs.refresh')}
          </button>
          <a className="button button--glass button--small" href={logsExportUrl(filters)} download>
            <DownloadIcon size={16} />
            {t('admin.logs.export')}
          </a>
        </div>
      </div>

      <div className="adm-toolbar">
        <div
          className="seg seg--4"
          role="group"
          aria-label={t('admin.logs.levelLabel')}
          data-active={logLevelFilters.indexOf(state.level)}
        >
          <span className="seg__indicator" aria-hidden="true" />
          {logLevelFilters.map((value: LogLevelFilter) => (
            <button
              key={value}
              type="button"
              className="seg__option"
              aria-pressed={state.level === value}
              onClick={() => update({ level: value })}
            >
              {t(`admin.logs.levelFilter.${value}`)}
            </button>
          ))}
        </div>
        <Field id={periodId} label={t('admin.logs.period')} compact trail={<SelectChevron />}>
          <select
            id={periodId}
            className="field__input"
            value={state.period}
            onChange={(event) =>
              update({ period: event.target.value as LogPeriod, anchor: Date.now() })
            }
          >
            {logPeriods.map((value) => (
              <option key={value} value={value}>
                {t(`admin.logs.periods.${value}`)}
              </option>
            ))}
          </select>
        </Field>
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

      <div className="adm-table" role="table" aria-label={t('admin.logs.title')}>
        <div className="adm-tr log-tr adm-tr--head" role="row">
          <span role="columnheader">{t('admin.logs.columns.time')}</span>
          <span role="columnheader">{t('admin.logs.columns.level')}</span>
          <span role="columnheader">{t('admin.logs.columns.message')}</span>
        </div>
        <div className="adm-table__body">
          {list.isPending ? <SkeletonRows /> : undefined}
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
