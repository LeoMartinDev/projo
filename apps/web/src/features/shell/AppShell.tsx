import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, Outlet, useNavigate } from '@tanstack/react-router'
import { type MouseEvent, useEffect, useState, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'

import type { MeResponse } from '@projo/shared/api/auth'

import { api, request } from '../../shared/api/client.ts'
import {
  canAdminister,
  canManageAccount,
  pickActiveProfile,
} from '../../shared/session/active-profile.ts'
import { sessionQuery, signedOut } from '../../shared/session/session.ts'
import { FilmIcon, LogoutIcon, SettingsIcon, TvIcon } from '../../shared/ui/icons.tsx'
import {
  BookmarkIcon,
  DevicesIcon,
  HomeIcon,
  SearchIcon,
  SlidersIcon,
  SwitchProfileIcon,
} from '../../shared/ui/media-icons.tsx'
import { unreadNotificationsQuery } from '../admin/operations/unread.ts'
import { SearchOverlay } from '../search/SearchOverlay.tsx'
import { Avatar } from './Avatar.tsx'
import { Logo } from './Logo.tsx'
import './shell.css'
import { usePillMerge } from './use-pill-merge.ts'

const closePopover = (event: MouseEvent<HTMLElement>) => {
  event.currentTarget.closest<HTMLElement>('[popover]')?.hidePopover()
}

/** Logout: revokes the cookie session, forgets the cache, back to the login screen. */
export const useLogout = () => {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  return useMutation({
    mutationFn: () => request(() => api.auth.logout.$post()),
    onSettled: async () => {
      signedOut(queryClient)
      await navigate({ to: '/login', replace: true })
    },
  })
}

/** Unread admin notifications on "Administration" (§15 "Badge in the menu"). */
const AdminBadge = () => {
  const { t } = useTranslation()
  const count = useQuery(unreadNotificationsQuery)
  if (count.data === undefined || count.data === 0) return undefined
  return (
    <span
      className="menu__count"
      aria-label={t('admin.notificationCenter.unread', { count: count.data })}
    >
      {count.data}
    </span>
  )
}

/**
 * Avatar menu (§13.2): switch profile, profile settings, account and devices,
 * administration (admins, from an unrestricted profile, §14), sign out.
 */
const AccountMenu = ({ me }: { me: MeResponse }) => {
  const { t } = useTranslation()
  const logout = useLogout()
  const profile = pickActiveProfile(me)
  const name = profile?.name ?? me.account.username
  return (
    <>
      <button
        type="button"
        className="account-button"
        popoverTarget="account-menu"
        aria-label={t('shell.accountMenu', { name })}
      >
        <Avatar name={name} color={profile?.avatarColor ?? 'slate'} />
      </button>
      <div id="account-menu" className="menu" popover="auto">
        <div className="menu__header">
          <Avatar name={name} color={profile?.avatarColor ?? 'slate'} size="large" />
          <div className="menu__who">
            <span className="menu__name">{name}</span>
            <span className="menu__role">{me.account.username}</span>
          </div>
        </div>
        <Link to="/profiles" className="menu__item" onClick={closePopover}>
          <SwitchProfileIcon />
          {t('shell.switchProfile')}
        </Link>
        <Link to="/settings/profile" className="menu__item" onClick={closePopover}>
          <SlidersIcon />
          {t('shell.profileSettings')}
        </Link>
        {canManageAccount(me) ? (
          <Link to="/settings/account" className="menu__item" onClick={closePopover}>
            <DevicesIcon />
            {t('shell.account')}
          </Link>
        ) : undefined}
        {canAdminister(me) ? (
          <Link to="/admin" className="menu__item" onClick={closePopover}>
            <SettingsIcon />
            {t('shell.admin')}
            <AdminBadge />
          </Link>
        ) : undefined}
        <span className="menu__separator" aria-hidden="true" />
        <button
          type="button"
          className="menu__item"
          disabled={logout.isPending}
          onClick={(event) => {
            closePopover(event)
            logout.mutate()
          }}
        >
          <LogoutIcon />
          {t('shell.logout')}
        </button>
      </div>
    </>
  )
}

const subscribeScroll = (notify: () => void) => {
  window.addEventListener('scroll', notify, { passive: true })
  return () => window.removeEventListener('scroll', notify)
}

/** The header turns into glass (phone) or one pill (wider) once the page scrolls under it. */
const useScrolled = () =>
  useSyncExternalStore(
    subscribeScroll,
    () => window.scrollY > 8,
    () => false,
  )

const isTyping = (target: unknown) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))

/**
 * Spectator layout (§13.2, artboards `Home`, `MobileHome`): `projo.`, the pill navigation
 * Home · Shows · Movies · My list, Search (`/`), the avatar menu. On a phone (`--compact`) the
 * navigation becomes the floating bottom bar, with Recherche as its fifth entry.
 */
export const AppShell = ({ me: initial }: { me: MeResponse }) => {
  const { t } = useTranslation()
  // Live session: a renamed or recoloured profile shows at once in the avatar.
  const session = useQuery(sessionQuery)
  const me = session.data?.status === 'signed_in' ? session.data.me : initial
  const scrolled = useScrolled()
  const headerRef = usePillMerge(scrolled)
  const [searching, setSearching] = useState(false)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return
      if (isTyping(event.target)) return
      event.preventDefault()
      setSearching(true)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="shell">
      <a className="skip-link" href="#main">
        {t('shell.skipToContent')}
      </a>
      <header className="shell__header" data-scrolled={scrolled} ref={headerRef}>
        <span className="pill-merge__glass" aria-hidden="true" />
        <svg className="pill-merge__paint" aria-hidden="true">
          <defs>
            <path id="pill-merge-shape" />
            <filter id="pill-merge-shadow" x="-10%" y="-60%" width="120%" height="220%">
              <feGaussianBlur stdDeviation="10" />
            </filter>
            <filter id="pill-merge-edge">
              <feMorphology in="SourceGraphic" operator="erode" radius="1" result="inner" />
              <feComposite in="SourceGraphic" in2="inner" operator="out" />
            </filter>
            <filter id="pill-merge-blur-logo" x="-20%" width="140%">
              <feGaussianBlur stdDeviation="0 0" />
            </filter>
            <filter id="pill-merge-blur-actions" x="-20%" width="140%">
              <feGaussianBlur stdDeviation="0 0" />
            </filter>
            <mask id="pill-merge-outside" maskUnits="userSpaceOnUse">
              <rect width="100%" height="100%" fill="#fff" />
              <use href="#pill-merge-shape" fill="#000" />
            </mask>
          </defs>
          <g mask="url(#pill-merge-outside)">
            <use href="#pill-merge-shape" y="6" className="pill-merge__shadow" />
          </g>
          <use href="#pill-merge-shape" className="pill-merge__tint" />
          <use href="#pill-merge-shape" className="pill-merge__edge" />
        </svg>
        <Link to="/" className="shell__logo" aria-label={t('shell.home')}>
          <Logo />
        </Link>
        <nav className="pill-nav" aria-label={t('shell.mainNavigation')}>
          <Link
            to="/"
            className="pill-nav__link"
            activeOptions={{ exact: true }}
            activeProps={{ 'aria-current': 'page' }}
          >
            <span className="pill-nav__icon" aria-hidden="true">
              <HomeIcon />
            </span>
            {t('nav.home')}
          </Link>
          <Link to="/series" className="pill-nav__link" activeProps={{ 'aria-current': 'page' }}>
            <span className="pill-nav__icon" aria-hidden="true">
              <TvIcon size={22} />
            </span>
            {t('nav.series')}
          </Link>
          <Link to="/movies" className="pill-nav__link" activeProps={{ 'aria-current': 'page' }}>
            <span className="pill-nav__icon" aria-hidden="true">
              <FilmIcon size={22} />
            </span>
            {t('nav.movies')}
          </Link>
          <Link to="/watchlist" className="pill-nav__link" activeProps={{ 'aria-current': 'page' }}>
            <span className="pill-nav__icon" aria-hidden="true">
              <BookmarkIcon />
            </span>
            {t('nav.watchlist')}
          </Link>
          <button
            type="button"
            className="pill-nav__link pill-nav__search"
            aria-expanded={searching}
            onClick={() => setSearching(true)}
          >
            <span className="pill-nav__icon" aria-hidden="true">
              <SearchIcon size={22} />
            </span>
            {t('nav.search')}
          </button>
        </nav>
        <div className="shell__actions">
          <button
            type="button"
            className="shell__icon-button shell__search"
            aria-label={t('shell.search')}
            aria-keyshortcuts="/"
            aria-expanded={searching}
            onClick={() => setSearching(true)}
          >
            <SearchIcon />
          </button>
          <AccountMenu me={me} />
        </div>
      </header>
      <main id="main" className="shell__main">
        <Outlet />
      </main>
      <SearchOverlay open={searching} onClose={() => setSearching(false)} />
    </div>
  )
}
