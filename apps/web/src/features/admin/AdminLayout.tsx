import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, Outlet, useRouterState } from '@tanstack/react-router'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'

import { eventHub } from '../../shared/events/events.ts'
import { setupStatusQuery } from '../../shared/session/session.ts'
import { AlertIcon, BackIcon, EyeOffIcon, LayersIcon, TvIcon } from '../../shared/ui/icons.tsx'
import { Logo } from '../shell/Logo.tsx'
import {
  BellIcon,
  DashboardIcon,
  JobsIcon,
  MissingIcon,
  PendingIcon,
  PlaybackIcon,
  ReviewIcon,
  ServerIcon,
  SkipIcon,
  TagIcon,
  UpdateIcon,
  UsersIcon,
} from './admin-icons.tsx'
import { reviewQueryKey } from './identify/queries.ts'
import { unreadNotificationsQuery, useLiveNotifications } from './operations/queries.ts'
import { reviewCountQuery } from './review/queries.ts'
import { settingsQuery } from './settings/queries.ts'
import { useUpdateSummary } from './updates/queries.ts'
import './admin.css'

/** Sidebar badge of "To review": the size of the whole queue. */
const ReviewCount = () => {
  const { t } = useTranslation()
  const count = useQuery(reviewCountQuery)
  if (count.data === undefined || count.data === 0) return undefined
  return (
    <span className="admin__count" aria-label={t('admin.review.count', { count: count.data })}>
      {count.data}
    </span>
  )
}

/** Sidebar badge of "Notifications" (§15): unread ones. */
const UnreadCount = () => {
  const { t } = useTranslation()
  const count = useQuery(unreadNotificationsQuery)
  if (count.data === undefined || count.data === 0) return undefined
  return (
    <span
      className="admin__count admin__count--strong"
      aria-label={t('admin.notificationCenter.unread', { count: count.data })}
    >
      {count.data}
    </span>
  )
}

/** Sidebar dot of "Updates": a newer release is available (§16.4). */
const UpdateAvailable = () => {
  const { t } = useTranslation()
  const { available } = useUpdateSummary()
  if (available === undefined) return undefined
  return (
    <span
      className="admin__dot"
      role="img"
      aria-label={t('admin.notifications.update/available')}
    />
  )
}

/**
 * §9.1: without a TMDB key, or with one TMDB now refuses, nothing is identified; the notification
 * of M5 is this banner for now.
 */
const TmdbKeyBanner = () => {
  const { t } = useTranslation()
  const settings = useQuery(settingsQuery)
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const state = settings.data?.metadata.tmdbApiKey.state
  if (state === undefined || state === 'valid') return undefined
  if (pathname.startsWith('/admin/settings/metadata')) return undefined
  return (
    <div className="admin-banner" role="status">
      <AlertIcon />
      <span className="admin-banner__text">
        {t(state === 'missing' ? 'admin.banner.tmdbKeyMissing' : 'admin.banner.tmdbKeyRejected')}
      </span>
      <Link to="/admin/settings/metadata" className="button button--glass button--small">
        {t('admin.banner.configure')}
      </Link>
    </div>
  )
}

/**
 * Finished scans and identification jobs change the "To review" queue: refetched live (SSE,
 * admin audience), debounced.
 */
const useLiveReviewQueue = () => {
  const queryClient = useQueryClient()
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const refresh = () => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        void queryClient.invalidateQueries({ queryKey: reviewQueryKey })
      }, 2000)
    }
    const unsubscribe = [
      eventHub.subscribe('scan.finished', refresh),
      eventHub.subscribe('job.updated', (job) => {
        if (job.type === 'match_source' && (job.state === 'done' || job.state === 'failed')) {
          refresh()
        }
      }),
    ]
    return () => {
      clearTimeout(timer)
      for (const off of unsubscribe) off()
    }
  }, [queryClient])
}

/** Administration layout (§15, artboards `AdminLibraries` / `AdminAccounts`): sidebar + page. */
export const AdminLayout = () => {
  const { t } = useTranslation()
  const status = useQuery(setupStatusQuery)
  const serverName = status.data?.serverName
  useLiveReviewQueue()
  useLiveNotifications()
  return (
    <div className="admin">
      <aside className="admin__side">
        <Link to="/" className="admin__logo">
          <Logo
            subtitle={
              serverName === undefined
                ? t('admin.title')
                : t('admin.titleWithServer', { server: serverName })
            }
          />
        </Link>
        <nav className="admin__nav" aria-label={t('admin.title')}>
          <Link
            to="/admin"
            className="admin__nav-link"
            activeOptions={{ exact: true }}
            activeProps={{ 'aria-current': 'page' }}
          >
            <DashboardIcon />
            <span className="admin__nav-label">{t('admin.dashboard.title')}</span>
          </Link>
          <span className="admin__nav-separator" aria-hidden="true" />
          <Link
            to="/admin/libraries"
            className="admin__nav-link"
            activeProps={{ 'aria-current': 'page' }}
          >
            <LayersIcon />
            <span className="admin__nav-label">{t('admin.libraries.title')}</span>
          </Link>
          <Link
            to="/admin/pending"
            className="admin__nav-link"
            activeProps={{ 'aria-current': 'page' }}
          >
            <PendingIcon />
            <span className="admin__nav-label">{t('admin.pending.title')}</span>
          </Link>
          <Link
            to="/admin/review"
            className="admin__nav-link"
            activeProps={{ 'aria-current': 'page' }}
          >
            <ReviewIcon />
            <span className="admin__nav-label">{t('admin.review.title')}</span>
            <ReviewCount />
          </Link>
          <Link
            to="/admin/missing"
            className="admin__nav-link"
            activeProps={{ 'aria-current': 'page' }}
          >
            <MissingIcon />
            <span className="admin__nav-label">{t('admin.missing.title')}</span>
          </Link>
          <Link
            to="/admin/hidden"
            className="admin__nav-link"
            activeProps={{ 'aria-current': 'page' }}
          >
            <EyeOffIcon />
            <span className="admin__nav-label">{t('admin.hidden.title')}</span>
          </Link>
          <span className="admin__nav-separator" aria-hidden="true" />
          <Link
            to="/admin/accounts"
            className="admin__nav-link"
            activeProps={{ 'aria-current': 'page' }}
          >
            <UsersIcon />
            <span className="admin__nav-label">{t('admin.accounts.title')}</span>
          </Link>
          <Link
            to="/admin/sessions"
            className="admin__nav-link"
            activeProps={{ 'aria-current': 'page' }}
          >
            <TvIcon />
            <span className="admin__nav-label">{t('admin.sessions.title')}</span>
          </Link>
          <span className="admin__nav-separator" aria-hidden="true" />
          <Link
            to="/admin/jobs"
            className="admin__nav-link"
            activeProps={{ 'aria-current': 'page' }}
          >
            <JobsIcon />
            <span className="admin__nav-label">{t('admin.jobs.title')}</span>
          </Link>
          <Link
            to="/admin/notifications"
            className="admin__nav-link"
            activeProps={{ 'aria-current': 'page' }}
          >
            <BellIcon />
            <span className="admin__nav-label">{t('admin.notificationCenter.title')}</span>
            <UnreadCount />
          </Link>
          <span className="admin__nav-separator" aria-hidden="true" />
          <Link
            to="/admin/settings/playback"
            className="admin__nav-link"
            activeProps={{ 'aria-current': 'page' }}
          >
            <PlaybackIcon />
            <span className="admin__nav-label">{t('admin.playbackSettings.title')}</span>
          </Link>
          <Link
            to="/admin/settings/segments"
            className="admin__nav-link"
            activeProps={{ 'aria-current': 'page' }}
          >
            <SkipIcon />
            <span className="admin__nav-label">{t('admin.settings.segments.title')}</span>
          </Link>
          <Link
            to="/admin/settings/metadata"
            className="admin__nav-link"
            activeProps={{ 'aria-current': 'page' }}
          >
            <TagIcon />
            <span className="admin__nav-label">{t('admin.settings.metadata')}</span>
          </Link>
          <Link
            to="/admin/updates"
            className="admin__nav-link"
            activeProps={{ 'aria-current': 'page' }}
          >
            <UpdateIcon />
            <span className="admin__nav-label">{t('admin.updates.title')}</span>
            <UpdateAvailable />
          </Link>
          <Link
            to="/admin/server"
            className="admin__nav-link"
            activeProps={{ 'aria-current': 'page' }}
          >
            <ServerIcon />
            <span className="admin__nav-label">{t('admin.server.title')}</span>
          </Link>
        </nav>
        <Link to="/movies" className="admin__nav-link admin__back">
          <BackIcon />
          <span className="admin__nav-label">{t('admin.backToCatalog')}</span>
        </Link>
      </aside>
      <main id="main" className="admin__main">
        <TmdbKeyBanner />
        <Outlet />
      </main>
    </div>
  )
}
