import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import type { NotificationSeverity } from '@projo/shared/api/notifications'
import type { RunningScanDto } from '@projo/shared/api/system'

import {
  formatDateTime,
  formatNumber,
  formatPercent,
  formatRelative,
} from '../../../shared/format/format.ts'
import { currentLocale } from '../../../shared/i18n/index.ts'
import { EmptyState, ErrorAlert } from '../../../shared/ui/states.tsx'
import { useNow } from '../../../shared/ui/use-now.ts'
import { AdminSection } from '../AdminSection.tsx'
import { type LiveScan, scanPercent, useLiveScans } from '../live-scans.ts'
import { notificationDetail, notificationTarget } from '../operations/notification-text.ts'
import {
  statsQuery,
  unreadNotificationsListQuery,
  useLiveNotifications,
  useLiveStats,
  useMarkNotificationsRead,
} from '../operations/queries.ts'
import { PlaybackSessions } from '../sessions/PlaybackSessions.tsx'
import { settingsQuery } from '../settings/queries.ts'
import { SkeletonRows } from '../SkeletonRows.tsx'
import { type TodoItem, todoItems } from './todo.ts'
import '../admin.css'
import '../admin-table.css'
import './overview.css'

const TodoRow = ({
  severity,
  title,
  detail,
  count,
  children,
}: {
  severity: NotificationSeverity
  title: string
  detail?: string | undefined
  count?: number
  children: ReactNode
}) => {
  const { t } = useTranslation()
  const locale = currentLocale()
  return (
    <li className="todo">
      <span className="todo__dot" data-severity={severity} aria-hidden="true" />
      <span className="todo__text">
        <span className="todo__title">{title}</span>
        {detail === undefined || detail === '' ? undefined : (
          <span className="todo__detail" title={detail}>
            <bdi>{detail}</bdi>
          </span>
        )}
      </span>
      {count === undefined || count < 2 ? undefined : (
        <span className="todo__count">
          {t('admin.overview.times', { count, formatted: formatNumber(count, locale) })}
        </span>
      )}
      <span className="todo__actions">{children}</span>
    </li>
  )
}

const TodoEntry = ({
  item,
  ignoring,
  onIgnore,
}: {
  item: TodoItem
  ignoring: boolean
  onIgnore: (item: Extract<TodoItem, { kind: 'notifications' }>) => void
}) => {
  const { t } = useTranslation()
  const locale = currentLocale()
  const open = 'button button--glass button--small'
  switch (item.kind) {
    case 'tmdb':
      return (
        <TodoRow
          severity="warning"
          title={t(
            item.state === 'missing'
              ? 'admin.banner.tmdbKeyMissing'
              : 'admin.banner.tmdbKeyRejected',
          )}
        >
          <Link to="/admin/settings/metadata" className={open}>
            {t('admin.banner.configure')}
          </Link>
        </TodoRow>
      )
    case 'review':
      return (
        <TodoRow
          severity="warning"
          title={t('admin.overview.review', {
            count: item.count,
            formatted: formatNumber(item.count, locale),
          })}
        >
          <Link to="/admin/review" className={open}>
            {t('admin.overview.open')}
          </Link>
        </TodoRow>
      )
    case 'missing':
      return (
        <TodoRow
          severity="info"
          title={t('admin.overview.missing', {
            count: item.count,
            formatted: formatNumber(item.count, locale),
          })}
        >
          <Link to="/admin/missing" className={open}>
            {t('admin.overview.open')}
          </Link>
        </TodoRow>
      )
    case 'failedJobs':
      return (
        <TodoRow
          severity="error"
          title={t('admin.overview.failedJobs', {
            count: item.count,
            formatted: formatNumber(item.count, locale),
          })}
        >
          <Link to="/admin/jobs" search={{ state: 'failed' }} className={open}>
            {t('admin.overview.open')}
          </Link>
        </TodoRow>
      )
    case 'update':
      return (
        <TodoRow
          severity={item.runtimeCompatible ? 'info' : 'warning'}
          title={t(
            item.runtimeCompatible ? 'admin.overview.update' : 'admin.overview.updateRuntime',
            { version: item.version },
          )}
        >
          <Link to="/admin/settings/updates" className={open}>
            {t('admin.overview.open')}
          </Link>
        </TodoRow>
      )
    case 'notifications': {
      const title = t(`admin.notifications.${item.notificationKind}`)
      return (
        <TodoRow
          severity={item.latest.severity}
          title={title}
          detail={notificationDetail(item.latest, t, locale)}
          count={item.count}
        >
          <button
            type="button"
            className="button button--small todo__ignore"
            disabled={ignoring}
            aria-label={t('admin.overview.ignoreNamed', { title })}
            onClick={() => onIgnore(item)}
          >
            {ignoring ? <span className="spinner" aria-hidden="true" /> : undefined}
            {t('admin.overview.ignore')}
          </button>
          <Link to={notificationTarget(item.notificationKind)} className={open}>
            {t('admin.overview.open')}
          </Link>
        </TodoRow>
      )
    }
  }
}

const keyOf = (item: TodoItem) =>
  item.kind === 'notifications' ? `notifications:${item.notificationKind}` : item.kind

const Todo = () => {
  const { t } = useTranslation()
  const stats = useQuery(statsQuery)
  const settings = useQuery(settingsQuery)
  const unread = useQuery(unreadNotificationsListQuery)
  const ignore = useMarkNotificationsRead()
  const loading = stats.isPending || settings.isPending || unread.isPending
  const items = todoItems({
    tmdbKey: settings.data?.metadata.tmdbApiKey.state,
    stats: stats.data,
    unread: unread.data ?? [],
  })
  return (
    <section className="overview__block" aria-labelledby="overview-todo">
      <h2 id="overview-todo" className="overview__title">
        {t('admin.overview.todo')}
      </h2>
      {ignore.isError ? <ErrorAlert error={ignore.error} /> : undefined}
      {unread.isError ? <ErrorAlert error={unread.error} /> : undefined}
      {loading ? (
        <div className="todo-list">
          <SkeletonRows count={2} />
        </div>
      ) : items.length === 0 ? (
        <div className="todo-list">
          <EmptyState compact title={t('admin.overview.nothingToDo')} />
        </div>
      ) : (
        <ul className="todo-list" aria-labelledby="overview-todo">
          {items.map((item) => (
            <TodoEntry
              key={keyOf(item)}
              item={item}
              ignoring={
                ignore.isPending &&
                item.kind === 'notifications' &&
                ignore.variables === item.notificationKind
              }
              onIgnore={(entry) => ignore.mutate(entry.notificationKind)}
            />
          ))}
        </ul>
      )}
    </section>
  )
}

const ScanRow = ({ scan, live }: { scan: RunningScanDto; live: LiveScan | undefined }) => {
  const { t } = useTranslation()
  const locale = currentLocale()
  const now = useNow()
  const percent = scanPercent(live)
  const label =
    live?.status === 'running' && live.phase === 'discovering'
      ? t('admin.analysis.found', {
          count: live.stats.seen,
          formatted: formatNumber(live.stats.seen, locale),
        })
      : t('admin.status.scanning')
  return (
    <div className="adm-tr overview-scan" role="row">
      <div className="adm-cell" role="cell">
        <Link
          to="/admin/libraries"
          search={{ library: scan.libraryId }}
          className="adm-strong overview-scan__name"
        >
          {scan.libraryName}
        </Link>
        <span className="adm-muted">
          {t(`admin.scanKind.${scan.kind}`)} ·{' '}
          <span title={formatDateTime(scan.startedAt, locale)}>
            {formatRelative(scan.startedAt, locale, now)}
          </span>
        </span>
      </div>
      <div className="adm-cell" role="cell">
        <span className="adm-muted">
          {percent === undefined ? label : `${label} · ${formatPercent(percent / 100, locale)}`}
        </span>
        {percent === undefined ? (
          <span className="bar-live">
            <progress className="bar" aria-label={label} />
          </span>
        ) : (
          <progress className="bar" value={percent} max={100} aria-label={label} />
        )}
      </div>
    </div>
  )
}

const Now = () => {
  const { t } = useTranslation()
  const stats = useQuery(statsQuery)
  const { scans } = useLiveScans()
  const running = stats.data?.runningScans ?? []
  return (
    <section className="overview__block" aria-labelledby="overview-now">
      <h2 id="overview-now" className="overview__title">
        {t('admin.overview.now')}
      </h2>
      <div className="adm-table overview-scans" role="table" aria-label={t('admin.overview.scans')}>
        <div className="adm-table__body">
          {stats.isPending ? <SkeletonRows count={1} /> : undefined}
          {stats.isSuccess && running.length === 0 ? (
            <EmptyState compact title={t('admin.overview.noScan')} />
          ) : undefined}
          {running.map((scan) => (
            <ScanRow key={scan.scanRunId} scan={scan} live={scans.get(scan.libraryId)} />
          ))}
        </div>
      </div>
      <PlaybackSessions />
    </section>
  )
}

const CatalogLine = () => {
  const { t } = useTranslation()
  const locale = currentLocale()
  const stats = useQuery(statsQuery)
  const data = stats.data
  if (data === undefined) return <p className="overview__catalog">{' '}</p>
  const count = (key: 'movies' | 'series' | 'episodes', value: number) =>
    t(`admin.overview.${key}`, { count: value, formatted: formatNumber(value, locale) })
  return (
    <p className="overview__catalog">
      {[
        count('movies', data.counts.movies),
        count('series', data.counts.series),
        count('episodes', data.counts.episodes),
        t('admin.overview.version', { version: data.version.app }),
        t('admin.updates.runtime', { version: data.version.runtime }),
      ].join(' · ')}
    </p>
  )
}

/** The overview of the admin (§15): what needs doing, what runs now, the catalogue in one line. */
export const OverviewPage = () => {
  const { t } = useTranslation()
  const stats = useQuery(statsQuery)
  useLiveStats()
  useLiveNotifications()
  return (
    <AdminSection title={t('admin.nav.overview')}>
      {stats.isError ? <ErrorAlert error={stats.error} /> : undefined}
      <Todo />
      <Now />
      <CatalogLine />
    </AdminSection>
  )
}
