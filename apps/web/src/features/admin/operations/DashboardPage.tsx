import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import type { AdminStatsDto, RunningScanDto } from '@projo/shared/api/system'

import {
  formatDateTime,
  formatNumber,
  formatPercent,
  formatRelative,
} from '../../../shared/format/format.ts'
import { currentLocale } from '../../../shared/i18n/index.ts'
import { ChevronRightIcon } from '../../../shared/ui/icons.tsx'
import { EmptyState, ErrorState } from '../../../shared/ui/states.tsx'
import { useNow } from '../../../shared/ui/use-now.ts'
import { type LiveScan, scanPercent, useLiveScans } from '../live-scans.ts'
import { useUpdateSummary } from '../updates/queries.ts'
import { statsQuery, useLiveNotifications, useLiveStats } from './queries.ts'
import '../admin.css'
import '../admin-table.css'
import './operations.css'

type Counter = {
  key: string
  label: string
  value: number | undefined
  to?:
    | '/admin/pending'
    | '/admin/review'
    | '/admin/missing'
    | '/admin/sessions'
    | '/admin/notifications'
    | '/admin/jobs'
  search?: { state: 'failed' }
  /** Draws the eye when not zero (something to act on). */
  alert?: boolean
}

const Tile = ({ counter }: { counter: Counter }) => {
  const locale = currentLocale()
  const content: ReactNode = (
    <>
      <span className="dash-tile__label">{counter.label}</span>
      <span className="dash-tile__value">
        {counter.value === undefined ? (
          <span className="skeleton skeleton--line dash-tile__skeleton" />
        ) : (
          formatNumber(counter.value, locale)
        )}
      </span>
      {counter.to === undefined ? undefined : (
        <span className="dash-tile__chevron" aria-hidden="true">
          <ChevronRightIcon size={16} />
        </span>
      )}
    </>
  )
  const attention = counter.alert === true && counter.value !== undefined && counter.value > 0
  if (counter.to === undefined)
    return (
      <div className="dash-tile" data-attention={attention}>
        {content}
      </div>
    )
  return (
    <Link
      to={counter.to}
      {...(counter.search === undefined ? {} : { search: counter.search })}
      className="dash-tile dash-tile--link"
      data-attention={attention}
    >
      {content}
    </Link>
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
    <div className="adm-tr dash-scan" role="row">
      <div className="adm-cell" role="cell">
        <Link
          to="/admin/libraries/$libraryId"
          params={{ libraryId: scan.libraryId }}
          className="adm-strong dash-scan__name"
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

const useCounters = (stats: AdminStatsDto | undefined): Counter[][] => {
  const { t } = useTranslation()
  return [
    [
      { key: 'movies', label: t('admin.dashboard.movies'), value: stats?.counts.movies },
      { key: 'series', label: t('admin.dashboard.series'), value: stats?.counts.series },
      { key: 'episodes', label: t('admin.dashboard.episodes'), value: stats?.counts.episodes },
    ],
    [
      {
        key: 'pending',
        label: t('admin.pending.title'),
        value: stats?.counts.pendingSources,
        to: '/admin/pending',
      },
      {
        key: 'review',
        label: t('admin.review.title'),
        value: stats?.counts.needsReview,
        to: '/admin/review',
        alert: true,
      },
      {
        key: 'missing',
        label: t('admin.missing.title'),
        value: stats?.counts.missingSources,
        to: '/admin/missing',
      },
    ],
    [
      {
        key: 'sessions',
        label: t('admin.sessions.title'),
        value: stats?.activePlaybackSessions,
        to: '/admin/sessions',
      },
      {
        key: 'notifications',
        label: t('admin.dashboard.unread'),
        value: stats?.unreadNotifications,
        to: '/admin/notifications',
        alert: true,
      },
      {
        key: 'jobs',
        label: t('admin.dashboard.failedJobs'),
        value: stats?.failedJobs,
        to: '/admin/jobs',
        search: { state: 'failed' },
        alert: true,
      },
    ],
  ]
}

/**
 * `/admin` (§15 "Dashboard"): the counters (movies, shows, episodes, files waiting, to
 * review, missing), the running scans with their progress (SSE), active sessions, unread
 * notifications, recent job failures, the versions and the update available.
 */
export const DashboardPage = () => {
  const { t } = useTranslation()
  const stats = useQuery(statsQuery)
  const update = useUpdateSummary()
  const { scans } = useLiveScans()
  useLiveStats()
  useLiveNotifications()
  const data = stats.data
  const groups = useCounters(data)
  // The updater's own status (live through `update.state`), else the dashboard's last check.
  const available = update.available ?? data?.updateAvailable?.version

  if (stats.isError && data === undefined)
    return (
      <div className="admin-page">
        <ErrorState error={stats.error} onRetry={() => void stats.refetch()} />
      </div>
    )

  return (
    <div className="admin-page">
      <div className="admin-page__header">
        <h1 className="admin-page__title">{t('admin.dashboard.title')}</h1>
      </div>

      <section className="dash-counters" aria-label={t('admin.dashboard.counters')}>
        {groups.map((group, index) => (
          <div key={index} className="dash-tiles">
            {group.map((counter) => (
              <Tile key={counter.key} counter={counter} />
            ))}
          </div>
        ))}
      </section>

      <section className="dash-section" aria-labelledby="dash-scans">
        <h2 id="dash-scans" className="admin-section__title">
          {t('admin.dashboard.scans')}
        </h2>
        <div className="adm-table" role="table" aria-labelledby="dash-scans">
          <div className="dash-scans__body">
            {data === undefined ? (
              <div className="adm-tr adm-tr--skeleton" aria-hidden="true">
                <span className="skeleton skeleton--line" />
              </div>
            ) : data.runningScans.length === 0 ? (
              <EmptyState title={t('admin.dashboard.noScan')} />
            ) : (
              data.runningScans.map((scan) => (
                <ScanRow key={scan.scanRunId} scan={scan} live={scans.get(scan.libraryId)} />
              ))
            )}
          </div>
        </div>
      </section>

      <section className="dash-section" aria-labelledby="dash-version">
        <h2 id="dash-version" className="admin-section__title">
          {t('admin.dashboard.version')}
        </h2>
        <div className="dash-versions">
          <div className="dash-tile">
            <span className="dash-tile__label">{t('admin.updates.current')}</span>
            <span className="dash-tile__value dash-tile__value--version">
              {data === undefined ? (
                <span className="skeleton skeleton--line dash-tile__skeleton" />
              ) : (
                data.version.app
              )}
            </span>
            <span className="dash-tile__sub">
              {data === undefined
                ? '\u00a0'
                : t('admin.updates.runtime', { version: data.version.runtime })}
            </span>
          </div>
          <Link
            to="/admin/updates"
            className="dash-tile dash-tile--link"
            data-attention={available !== undefined}
          >
            <span className="dash-tile__label">{t('admin.updates.available')}</span>
            <span className="dash-tile__value dash-tile__value--version">{available ?? '—'}</span>
            <span className="dash-tile__sub">
              {available === undefined
                ? t('admin.updates.upToDate')
                : t('admin.dashboard.updateReady')}
            </span>
            <span className="dash-tile__chevron" aria-hidden="true">
              <ChevronRightIcon size={16} />
            </span>
          </Link>
        </div>
      </section>
    </div>
  )
}
