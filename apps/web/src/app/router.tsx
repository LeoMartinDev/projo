import type { QueryClient } from '@tanstack/react-query'
import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  lazyRouteComponent,
  Link,
  Outlet,
  redirect,
} from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'

import { LoginPage } from '../features/auth/LoginPage.tsx'
import { parseCatalogSearch } from '../features/catalog/catalog-state.ts'
import { CatalogPage } from '../features/catalog/CatalogPage.tsx'
import { HomePage, HomeSkeleton } from '../features/home/HomePage.tsx'
import { loadHome } from '../features/home/load-home.ts'
import { loadItem } from '../features/item/load-item.ts'
import { WhoIsWatching } from '../features/profiles/WhoIsWatching.tsx'
import { WatchlistPage } from '../features/watchlist/WatchlistPage.tsx'
import { AppShell } from '../features/shell/AppShell.tsx'
import { canAdminister, canManageAccount } from '../shared/session/active-profile.ts'
import { applyMe, sessionQuery, setupStatusQuery } from '../shared/session/session.ts'
import { EmptyState, ErrorState, FullPageSpinner } from '../shared/ui/states.tsx'
import { AuthedLayout } from './AuthedLayout.tsx'

export type RouterContext = { queryClient: QueryClient }

/*
 * Pages off the way to the home (setup, invitation, fiche, player, settings, administration) are
 * chunks of their own, JS and CSS, so the first visit only loads the shell, the home and the
 * catalog. A route renders once its chunk is there (the previous page stays meanwhile), and
 * `defaultPreload: 'intent'` fetches it on hover. A page wrapped by its route (params, search)
 * is waited for in the route's `loader`.
 */
const SetupWizard = lazyRouteComponent(
  () => import('../features/setup/SetupWizard.tsx'),
  'SetupWizard',
)
const InvitePage = lazyRouteComponent(
  () => import('../features/invite/InvitePage.tsx'),
  'InvitePage',
)
const ItemPage = lazyRouteComponent(() => import('../features/item/ItemPage.tsx'), 'ItemPage')
const PlayerPage = lazyRouteComponent(
  () => import('../features/player/PlayerPage.tsx'),
  'PlayerPage',
)
const AccountPage = lazyRouteComponent(
  () => import('../features/account/AccountPage.tsx'),
  'AccountPage',
)
const ProfileSettingsPage = lazyRouteComponent(
  () => import('../features/profiles/ProfileSettingsPage.tsx'),
  'ProfileSettingsPage',
)
const AdminLayout = lazyRouteComponent(
  () => import('../features/admin/AdminLayout.tsx'),
  'AdminLayout',
)
const LibrariesPage = lazyRouteComponent(
  () => import('../features/admin/LibrariesPage.tsx'),
  'LibrariesPage',
)
const NewLibraryPage = lazyRouteComponent(
  () => import('../features/admin/LibraryPages.tsx'),
  'NewLibraryPage',
)
const EditLibraryPage = lazyRouteComponent(
  () => import('../features/admin/LibraryPages.tsx'),
  'EditLibraryPage',
)
const AccountsPage = lazyRouteComponent(
  () => import('../features/admin/accounts/AccountsPage.tsx'),
  'AccountsPage',
)
const ReviewPage = lazyRouteComponent(
  () => import('../features/admin/review/ReviewPage.tsx'),
  'ReviewPage',
)
const SessionsPage = lazyRouteComponent(
  () => import('../features/admin/sessions/SessionsPage.tsx'),
  'SessionsPage',
)
const UpdatesPage = lazyRouteComponent(
  () => import('../features/admin/updates/UpdatesPage.tsx'),
  'UpdatesPage',
)
const MetadataSettingsPage = lazyRouteComponent(
  () => import('../features/admin/settings/SettingsPage.tsx'),
  'MetadataSettingsPage',
)
const SegmentsSettingsPage = lazyRouteComponent(
  () => import('../features/admin/settings/SettingsPage.tsx'),
  'SegmentsSettingsPage',
)
const PlaybackSettingsPage = lazyRouteComponent(
  () => import('../features/admin/settings/PlaybackSettingsPage.tsx'),
  'PlaybackSettingsPage',
)
const ServerPage = lazyRouteComponent(
  () => import('../features/admin/settings/ServerPage.tsx'),
  'ServerPage',
)
const DashboardPage = lazyRouteComponent(
  () => import('../features/admin/operations/DashboardPage.tsx'),
  'DashboardPage',
)
const JobsPage = lazyRouteComponent(
  () => import('../features/admin/operations/JobsPage.tsx'),
  'JobsPage',
)
const NotificationsPage = lazyRouteComponent(
  () => import('../features/admin/operations/NotificationsPage.tsx'),
  'NotificationsPage',
)
const PendingPage = lazyRouteComponent(
  () => import('../features/admin/operations/SourceStatePages.tsx'),
  'PendingPage',
)
const MissingPage = lazyRouteComponent(
  () => import('../features/admin/operations/SourceStatePages.tsx'),
  'MissingPage',
)
const HiddenPage = lazyRouteComponent(
  () => import('../features/admin/operations/SourceStatePages.tsx'),
  'HiddenPage',
)

const NotFound = () => {
  const { t } = useTranslation()
  return (
    <EmptyState
      title={t('common.notFound')}
      action={
        <Link to="/" className="button button--glass">
          {t('common.home')}
        </Link>
      }
    />
  )
}

const rootRoute = createRootRouteWithContext<RouterContext>()({
  component: () => <Outlet />,
  pendingComponent: FullPageSpinner,
  errorComponent: ({ error, reset }) => <ErrorState error={error} onRetry={reset} />,
  notFoundComponent: NotFound,
})

const setupRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/setup',
  beforeLoad: async ({ context: { queryClient } }) => {
    const status = await queryClient.ensureQueryData(setupStatusQuery)
    if (status.completed) throw redirect({ to: '/' })
  },
  component: SetupWizard,
})

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  validateSearch: (search: Record<string, unknown>): { redirect?: string } =>
    typeof search['redirect'] === 'string' ? { redirect: search['redirect'] } : {},
  beforeLoad: async ({ context: { queryClient } }) => {
    const [status, session] = await Promise.all([
      queryClient.ensureQueryData(setupStatusQuery),
      queryClient.ensureQueryData(sessionQuery),
    ])
    if (!status.completed) throw redirect({ to: '/setup' })
    if (session.status === 'signed_in') throw redirect({ to: '/' })
  },
  component: function Login() {
    const { redirect: target } = loginRoute.useSearch()
    return <LoginPage {...(target === undefined ? {} : { redirectTo: target })} />
  },
})

/** Invitation link (§14): public, signs the new account in. */
const inviteRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/invite/$token',
  loader: () => InvitePage.preload?.(),
  component: function Invite() {
    const { token } = inviteRoute.useParams()
    return <InvitePage key={token} token={token} />
  },
})

/**
 * Everything behind the login: setup done, a session, the active profile applied. Without an
 * active profile (several profiles, none restored for this device, or a PIN to type) every page
 * leads to "Who's watching?" first (§13.6).
 */
const authedRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'authed',
  beforeLoad: async ({ context: { queryClient }, location }) => {
    const [status, session] = await Promise.all([
      queryClient.ensureQueryData(setupStatusQuery),
      queryClient.ensureQueryData(sessionQuery),
    ])
    if (!status.completed) throw redirect({ to: '/setup' })
    if (session.status === 'anonymous')
      throw redirect({ to: '/login', search: { redirect: location.href } })
    applyMe(session.me)
    if (session.me.needsProfileSelection && location.pathname !== '/profiles')
      throw redirect({ to: '/profiles', search: { redirect: location.href } })
    return { me: session.me }
  },
  component: function Authed() {
    const { me } = authedRoute.useRouteContext()
    return <AuthedLayout me={me} />
  },
})

const shellRoute = createRoute({
  getParentRoute: () => authedRoute,
  id: 'shell',
  component: function Shell() {
    const { me } = shellRoute.useRouteContext()
    return <AppShell me={me} />
  },
})

/** "Who's watching?" and "Manage profiles" (§13.6): full screen, outside the shell. */
const profilesRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/profiles',
  validateSearch: (search: Record<string, unknown>): { redirect?: string; manage?: boolean } => ({
    ...(typeof search['redirect'] === 'string' ? { redirect: search['redirect'] } : {}),
    ...(search['manage'] === true || search['manage'] === 'true' ? { manage: true } : {}),
  }),
  component: function Profiles() {
    const { me } = profilesRoute.useRouteContext()
    const { redirect: target, manage } = profilesRoute.useSearch()
    return (
      <WhoIsWatching
        me={me}
        manage={manage === true}
        {...(target === undefined ? {} : { redirectTo: target })}
      />
    )
  },
})

const indexRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/',
  loader: ({ context: { queryClient } }) => loadHome(queryClient),
  pendingComponent: HomeSkeleton,
  component: HomePage,
})

/** `?sort=added&genre=`: "See all ›" of Recently added and the genre rows (§13.3). */
const validateCatalogSearch = parseCatalogSearch

const moviesRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/movies',
  validateSearch: validateCatalogSearch,
  component: function Movies() {
    return <CatalogPage key="movies" kind="movies" search={moviesRoute.useSearch()} />
  },
})

const seriesRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/series',
  validateSearch: validateCatalogSearch,
  component: function Series() {
    return <CatalogPage key="series" kind="series" search={seriesRoute.useSearch()} />
  },
})

const watchlistRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/watchlist',
  component: WatchlistPage,
})

const profileSettingsRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/settings/profile',
  component: ProfileSettingsPage,
})

const accountRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/settings/account',
  loader: () => AccountPage.preload?.(),
  beforeLoad: ({ context: { me } }) => {
    if (!canManageAccount(me)) throw redirect({ to: '/' })
  },
  component: function Account() {
    const { me } = accountRoute.useRouteContext()
    return <AccountPage me={me} />
  },
})

const validateItemSearch = (search: Record<string, unknown>): { season?: number } => {
  const season = Number(search['season'])
  return Number.isInteger(season) && season >= 0 ? { season } : {}
}

const itemRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/items/$itemId',
  // The season is read here, not as `loaderDeps`: switching tabs must not wait on the loader.
  loader: ({ context: { queryClient }, params: { itemId }, location }) =>
    Promise.all([
      ItemPage.preload?.(),
      loadItem(queryClient, { itemId, ...validateItemSearch(location.search) }),
    ]),
  validateSearch: validateItemSearch,
  component: function Item() {
    const { itemId } = itemRoute.useParams()
    const { season } = itemRoute.useSearch()
    return <ItemPage key={itemId} itemId={itemId} {...(season === undefined ? {} : { season })} />
  },
})

const watchRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/watch/$itemId',
  loader: () => PlayerPage.preload?.(),
  validateSearch: (search: Record<string, unknown>): { from?: 'start' } =>
    search['from'] === 'start' ? { from: 'start' } : {},
  component: function Watch() {
    const { itemId } = watchRoute.useParams()
    const { from } = watchRoute.useSearch()
    return <PlayerPage key={itemId} itemId={itemId} fromStart={from === 'start'} />
  },
})

const adminRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/admin',
  beforeLoad: ({ context: { me } }) => {
    if (!canAdminister(me)) throw redirect({ to: '/' })
  },
  component: AdminLayout,
})

/** §15 "Dashboard": the administration's home. */
const adminIndexRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: '/',
  component: DashboardPage,
})

const adminLibrariesRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: '/libraries',
  component: LibrariesPage,
})

const adminNewLibraryRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: '/libraries/new',
  component: NewLibraryPage,
})

const adminLibraryRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: '/libraries/$libraryId',
  loader: () => EditLibraryPage.preload?.(),
  component: function AdminLibrary() {
    const { libraryId } = adminLibraryRoute.useParams()
    return <EditLibraryPage key={libraryId} libraryId={libraryId} />
  },
})

const adminAccountsRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: '/accounts',
  component: AccountsPage,
})

const adminReviewRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: '/review',
  component: ReviewPage,
})

const adminSessionsRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: '/sessions',
  component: SessionsPage,
})

const adminUpdatesRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: '/updates',
  component: UpdatesPage,
})

/** The settings of §15 are one page each; `/admin/settings` (M2–M4 links) leads to the first. */
const adminSettingsRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: '/settings',
  beforeLoad: () => {
    throw redirect({ to: '/admin/settings/metadata', replace: true })
  },
})

const adminMetadataSettingsRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: '/settings/metadata',
  component: MetadataSettingsPage,
})

const adminSegmentsSettingsRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: '/settings/segments',
  component: SegmentsSettingsPage,
})

const adminPlaybackSettingsRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: '/settings/playback',
  component: PlaybackSettingsPage,
})

const adminServerRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: '/server',
  component: ServerPage,
})

const adminPendingRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: '/pending',
  component: PendingPage,
})

const adminMissingRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: '/missing',
  component: MissingPage,
})

const adminHiddenRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: '/hidden',
  component: HiddenPage,
})

const jobFilterValues = ['running', 'queued', 'failed'] as const
type JobFilterSearch = (typeof jobFilterValues)[number]

/** `?state=failed`: "Failed jobs" of the dashboard. */
const adminJobsRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: '/jobs',
  validateSearch: (search: Record<string, unknown>): { state?: JobFilterSearch } => {
    const state = jobFilterValues.find((value) => value === search['state'])
    return state === undefined ? {} : { state }
  },
  loader: () => JobsPage.preload?.(),
  component: function AdminJobs() {
    const { state } = adminJobsRoute.useSearch()
    const navigate = adminJobsRoute.useNavigate()
    return (
      <JobsPage
        filter={state ?? 'all'}
        onFilter={(filter) =>
          void navigate({ search: filter === 'all' ? {} : { state: filter }, replace: true })
        }
      />
    )
  },
})

const adminNotificationsRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: '/notifications',
  component: NotificationsPage,
})

export const routeTree = rootRoute.addChildren([
  setupRoute,
  loginRoute,
  inviteRoute,
  authedRoute.addChildren([
    shellRoute.addChildren([
      indexRoute,
      moviesRoute,
      seriesRoute,
      watchlistRoute,
      itemRoute,
      profileSettingsRoute,
      accountRoute,
    ]),
    profilesRoute,
    watchRoute,
    adminRoute.addChildren([
      adminIndexRoute,
      adminLibrariesRoute,
      adminNewLibraryRoute,
      adminLibraryRoute,
      adminAccountsRoute,
      adminReviewRoute,
      adminSessionsRoute,
      adminUpdatesRoute,
      adminSettingsRoute,
      adminMetadataSettingsRoute,
      adminSegmentsSettingsRoute,
      adminPlaybackSettingsRoute,
      adminServerRoute,
      adminPendingRoute,
      adminMissingRoute,
      adminHiddenRoute,
      adminJobsRoute,
      adminNotificationsRoute,
    ]),
  ]),
])

export const createAppRouter = (queryClient: QueryClient) =>
  createRouter({
    routeTree,
    context: { queryClient },
    defaultPreload: 'intent',
    defaultPreloadStaleTime: 0,
    scrollRestoration: true,
  })

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createAppRouter>
  }
}
