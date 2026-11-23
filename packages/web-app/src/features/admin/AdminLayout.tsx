import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, Outlet, useRouterState } from '@tanstack/react-router'
import { Suspense, useEffect } from 'react'
import { useTranslation } from 'react-i18next'

import { eventHub } from '../../shared/events/events.ts'
import { setupStatusQuery } from '../../shared/session/session.ts'
import { AlertIcon, BackIcon, LayersIcon, SettingsIcon } from '../../shared/ui/icons.tsx'
import { useElement } from '../../shared/ui/use-element.ts'
import { Logo } from '../shell/Logo.tsx'
import { BellIcon, DashboardIcon, ReviewIcon, UsersIcon } from './admin-icons.tsx'
import { adminNavEntryOf } from './admin-nav.ts'
import { reviewQueryKey } from './identify/queries.ts'
import { unreadNotificationsQuery, useLiveNotifications } from './operations/queries.ts'
import { reviewCountQuery } from './review/queries.ts'
import { settingsQuery } from './settings/queries.ts'
import { useUpdateSummary } from './updates/queries.ts'
import './admin.css'

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

const TmdbKeyBanner = () => {
  const { t } = useTranslation()
  const settings = useQuery(settingsQuery)
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const state = settings.data?.metadata.tmdbApiKey.state
  if (state === undefined || state === 'valid') return undefined
  // On the overview its "To do" says it; on the metadata settings, the key's own field does.
  if (adminNavEntryOf(pathname) === 'overview' || pathname.startsWith('/admin/settings/metadata'))
    return undefined
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

export const AdminLayout = () => {
  const { t } = useTranslation()
  const status = useQuery(setupStatusQuery)
  const serverName = status.data?.serverName
  useLiveReviewQueue()
  useLiveNotifications()
  const [nav, navRef] = useElement<HTMLElement>()
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const current = adminNavEntryOf(pathname)
  useEffect(() => {
    nav
      ?.querySelector('[aria-current="page"]')
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [nav, pathname])
  return (
    <div className="admin">
      <aside className="admin__side" data-window-top>
        <Link to="/" className="admin__logo">
          <Logo
            subtitle={
              serverName === undefined
                ? t('admin.title')
                : t('admin.titleWithServer', { server: serverName })
            }
          />
        </Link>
        <nav ref={navRef} className="admin__nav" aria-label={t('admin.title')}>
          <Link
            to="/admin"
            className="admin__nav-link"
            activeOptions={{ exact: true }}
            aria-current={current === 'overview' ? 'page' : undefined}
          >
            <DashboardIcon />
            <span className="admin__nav-label">{t('admin.nav.overview')}</span>
          </Link>
          <span className="admin__nav-separator" aria-hidden="true" />
          <Link
            to="/admin/libraries"
            className="admin__nav-link"
            activeOptions={{ exact: true }}
            aria-current={current === 'media' ? 'page' : undefined}
          >
            <LayersIcon />
            <span className="admin__nav-label">{t('admin.nav.media')}</span>
          </Link>
          <Link
            to="/admin/review"
            className="admin__nav-link"
            activeOptions={{ exact: true }}
            aria-current={current === 'files' ? 'page' : undefined}
          >
            <ReviewIcon />
            <span className="admin__nav-label">{t('admin.nav.files')}</span>
            <ReviewCount />
          </Link>
          <Link
            to="/admin/accounts"
            className="admin__nav-link"
            activeOptions={{ exact: true }}
            aria-current={current === 'accounts' ? 'page' : undefined}
          >
            <UsersIcon />
            <span className="admin__nav-label">{t('admin.nav.accounts')}</span>
          </Link>
          <Link
            to="/admin/notifications"
            className="admin__nav-link"
            activeOptions={{ exact: true }}
            aria-current={current === 'activity' ? 'page' : undefined}
          >
            <BellIcon />
            <span className="admin__nav-label">{t('admin.nav.activity')}</span>
            <UnreadCount />
          </Link>
          <Link
            to="/admin/settings/general"
            className="admin__nav-link"
            activeOptions={{ exact: true }}
            aria-current={current === 'settings' ? 'page' : undefined}
          >
            <SettingsIcon />
            <span className="admin__nav-label">{t('admin.nav.settings')}</span>
            <UpdateAvailable />
          </Link>
        </nav>
        <Link to="/movies" className="admin__nav-link admin__back">
          <BackIcon />
          <span className="admin__nav-label">{t('admin.backToCatalog')}</span>
        </Link>
      </aside>
      <main id="main" className="admin__main" tabIndex={-1}>
        <TmdbKeyBanner />
        {/* A page still loading its chunk leaves the sidebar in place, never the whole app blank. */}
        <Suspense fallback={undefined}>
          <Outlet />
        </Suspense>
      </main>
    </div>
  )
}
