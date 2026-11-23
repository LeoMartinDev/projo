import type { QueryClient } from '@tanstack/react-query'
import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  type ErrorComponentProps,
  lazyRouteComponent,
  Link,
  Outlet,
  redirect,
  useRouter,
} from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'

import { LoginPage } from '../features/auth/LoginPage.tsx'
import { homeCategorySlugSchema } from '@projo/shared/api/home'

import { parseCatalogSearch } from '../features/catalog/catalog-state.ts'
import { CatalogSkeleton } from '../features/catalog/CatalogPage.tsx'
import { arriveOnCatalog, loadCatalog, loadWatchlist } from '../features/catalog/load-catalog.ts'
import { CategoryPage } from '../features/home/CategoryPage.tsx'
import { HomeSkeleton } from '../features/home/HomePage.tsx'
import { loadHome } from '../features/home/load-home.ts'
import { loadItem } from '../features/item/load-item.ts'
import { WhoIsWatching } from '../features/profiles/WhoIsWatching.tsx'
import { AppShell } from '../features/shell/AppShell.tsx'
import { UpdateBanner } from '../shared/app-update/UpdateBanner.tsx'
import { isKeptTab } from '../features/shell/KeptTabs.tsx'
import { parseTvView, type TvView } from '../features/tv/tv-view.ts'
import { canAdminister, canManageAccount } from '../shared/session/active-profile.ts'
import { applyMe, sessionQuery, setupStatusQuery } from '../shared/session/session.ts'
import { EmptyState, ErrorState, FullPageSpinner } from '../shared/ui/states.tsx'
import { useGamepad } from '../shared/ui/gamepad/use-gamepad.ts'
import { useInputModality } from '../shared/ui/input-modality.ts'
import { useSpatialNavigation } from '../shared/ui/spatial-nav/use-spatial-navigation.ts'
import { useFocusOnNavigation } from '../shared/ui/use-focus-on-navigation.ts'
import { useHost } from '../host.ts'
import { AuthedLayout } from './AuthedLayout.tsx'

export type RouterContext = { queryClient: QueryClient }

const SetupWizard = lazyRouteComponent(
  () => import('../features/setup/SetupWizard.tsx'),
  'SetupWizard',
)
const InvitePage = lazyRouteComponent(
  () => import('../features/invite/InvitePage.tsx'),
  'InvitePage',
)
const PairPage = lazyRouteComponent(() => import('../features/pair/PairPage.tsx'), 'PairPage')
const OAuthAuthorizePage = lazyRouteComponent(
  () => import('../features/oauth/OAuthAuthorizePage.tsx'),
  'OAuthAuthorizePage',
)
const ItemPage = lazyRouteComponent(() => import('../features/item/ItemPage.tsx'), 'ItemPage')
const PlayerRoute = lazyRouteComponent(
  () => import('../features/player/player-route.tsx'),
  'PlayerRoute',
)
const LivePlayerRoute = lazyRouteComponent(
  () => import('../features/player/live-player-route.tsx'),
  'LivePlayerRoute',
)
const TvPage = lazyRouteComponent(() => import('../features/tv/TvPage.tsx'), 'TvPage')
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
const TvSourcesPage = lazyRouteComponent(
  () => import('../features/admin/tv/TvSourcesPage.tsx'),
  'TvSourcesPage',
)
const AccountsPage = lazyRouteComponent(
  () => import('../features/admin/accounts/AccountsPage.tsx'),
  'AccountsPage',
)
const ReviewPage = lazyRouteComponent(
  () => import('../features/admin/review/ReviewPage.tsx'),
  'ReviewPage',
)
const UpdatesPage = lazyRouteComponent(
  () => import('../features/admin/updates/UpdatesPage.tsx'),
  'UpdatesPage',
)
const GeneralSettingsPage = lazyRouteComponent(
  () => import('../features/admin/settings/GeneralSettingsPage.tsx'),
  'GeneralSettingsPage',
)
const AssistantsSettingsPage = lazyRouteComponent(
  () => import('../features/admin/settings/AssistantsSettingsPage.tsx'),
  'AssistantsSettingsPage',
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
const OverviewPage = lazyRouteComponent(
  () => import('../features/admin/overview/OverviewPage.tsx'),
  'OverviewPage',
)
const JobsPage = lazyRouteComponent(
  () => import('../features/admin/operations/JobsPage.tsx'),
  'JobsPage',
)
const LogsPage = lazyRouteComponent(
  () => import('../features/admin/operations/LogsPage.tsx'),
  'LogsPage',
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

const RouteError = ({ error }: ErrorComponentProps) => {
  const router = useRouter()
  return <ErrorState error={error} onRetry={() => void router.invalidate()} />
}

// The host's window chrome (the desktop app's buttons) over every page.
const HostChrome = () => useHost().chrome

// Keyboard or pointer, focus moved to the page on navigation, restored on back,
// arrows, Enter and back keys, a gamepad (§19).
const KeyboardFocus = () => {
  useInputModality()
  useFocusOnNavigation()
  useSpatialNavigation()
  useGamepad()
  return undefined
}

const rootRoute = createRootRouteWithContext<RouterContext>()({
  component: () => (
    <>
      <Outlet />
      <UpdateBanner />
      <HostChrome />
      <KeyboardFocus />
    </>
  ),
  pendingComponent: FullPageSpinner,
  errorComponent: RouteError,
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

const inviteRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/invite/$token',
  loader: () => InvitePage.preload?.(),
  component: function Invite() {
    const { token } = inviteRoute.useParams()
    return <InvitePage key={token} token={token} />
  },
})

const pairRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/pair',
  component: PairPage,
})

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

const KeptTab = () => undefined

const indexRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/',
  loader: ({ context: { queryClient } }) => loadHome(queryClient),
  pendingComponent: HomeSkeleton,
  component: KeptTab,
})

const validateCatalogSearch = parseCatalogSearch

const moviesRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/movies',
  validateSearch: validateCatalogSearch,
  beforeLoad: ({ search, preload }) => arriveOnCatalog('movies', search, preload),
  loader: ({ context: { queryClient } }) => loadCatalog(queryClient, 'movies'),
  pendingComponent: () => <CatalogSkeleton kind="movies" />,
  component: KeptTab,
})

const seriesRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/series',
  validateSearch: validateCatalogSearch,
  beforeLoad: ({ search, preload }) => arriveOnCatalog('series', search, preload),
  loader: ({ context: { queryClient } }) => loadCatalog(queryClient, 'series'),
  pendingComponent: () => <CatalogSkeleton kind="series" />,
  component: KeptTab,
})

const categoryRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/categories/$category',
  component: function Category() {
    const category = homeCategorySlugSchema.safeParse(categoryRoute.useParams().category)
    return category.success ? (
      <CategoryPage key={category.data} category={category.data} />
    ) : (
      <NotFound />
    )
  },
})

const watchlistRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/watchlist',
  loader: ({ context: { queryClient } }) => loadWatchlist(queryClient),
  pendingComponent: () => <CatalogSkeleton kind="watchlist" />,
  component: KeptTab,
})

const tvRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/tv',
  validateSearch: (search: Record<string, unknown>): { view?: TvView } => {
    const view = parseTvView(search['view'])
    return view === undefined ? {} : { view }
  },
  loader: () => TvPage.preload?.(),
  component: function Tv() {
    const { view } = tvRoute.useSearch()
    const navigate = tvRoute.useNavigate()
    return (
      <TvPage
        view={view}
        onView={(next) => void navigate({ search: { view: next }, replace: true })}
      />
    )
  },
})

const shellNotFoundRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '$',
  component: () => (
    <div className="page page--state">
      <NotFound />
    </div>
  ),
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
  loader: () => PlayerRoute.preload?.(),
  validateSearch: (search: Record<string, unknown>): { from?: 'start' } =>
    search['from'] === 'start' ? { from: 'start' } : {},
  component: function Watch() {
    const { itemId } = watchRoute.useParams()
    const { from } = watchRoute.useSearch()
    return <PlayerRoute key={itemId} itemId={itemId} fromStart={from === 'start'} />
  },
})

const watchTvRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/watch/tv/$channelId',
  loader: () => LivePlayerRoute.preload?.(),
  component: function WatchTv() {
    const { channelId } = watchTvRoute.useParams()
    return <LivePlayerRoute channelId={channelId} />
  },
})

const oauthAuthorizeRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/oauth/authorize',
  component: OAuthAuthorizePage,
})

const adminRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/admin',
  beforeLoad: ({ context: { me } }) => {
    if (!canAdminister(me)) throw redirect({ to: '/' })
  },
  component: AdminLayout,
})

const adminIndexRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: '/',
  component: OverviewPage,
})

// A record of a collection opens in a dialog over its table: `?library=<id>` (or `new`).
const recordParam = (value: unknown): string | undefined =>
  typeof value === 'string' && value !== '' ? value : undefined

const adminLibrariesRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: '/libraries',
  validateSearch: (search: Record<string, unknown>): { library?: string } => {
    const library = recordParam(search['library'])
    return library === undefined ? {} : { library }
  },
  // The component is a wrapper, so the router cannot see the lazy page it renders: load its
  // chunk with the route, or it suspends on first render and blanks the whole app meanwhile.
  loader: () => LibrariesPage.preload?.(),
  component: function AdminLibraries() {
    const { library } = adminLibrariesRoute.useSearch()
    const navigate = adminLibrariesRoute.useNavigate()
    return (
      <LibrariesPage
        opened={library}
        onClose={() => void navigate({ search: {}, replace: true })}
      />
    )
  },
})

// The library's page of old (and `/libraries/new`): its dialog.
const adminLibraryRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: '/libraries/$libraryId',
  beforeLoad: ({ params }) => {
    throw redirect({
      to: '/admin/libraries',
      search: { library: params.libraryId },
      replace: true,
    })
  },
})

const adminTvRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: '/tv',
  component: TvSourcesPage,
})

const adminAccountsRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: '/accounts',
  validateSearch: (search: Record<string, unknown>): { account?: string } => {
    const account = recordParam(search['account'])
    return account === undefined ? {} : { account }
  },
  loader: () => AccountsPage.preload?.(),
  component: function AdminAccounts() {
    const { account } = adminAccountsRoute.useSearch()
    const navigate = adminAccountsRoute.useNavigate()
    return (
      <AccountsPage
        opened={account}
        onOpen={(opened) =>
          void navigate({ search: opened === undefined ? {} : { account: opened }, replace: true })
        }
      />
    )
  },
})

// The account's page of old (and `/accounts/new`): its dialog.
const adminAccountRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: '/accounts/$accountId',
  beforeLoad: ({ params }) => {
    throw redirect({
      to: '/admin/accounts',
      search: { account: params.accountId },
      replace: true,
    })
  },
})

const adminReviewRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: '/review',
  component: ReviewPage,
})

// The sessions now play on the overview.
const adminSessionsRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: '/sessions',
  beforeLoad: () => {
    throw redirect({ to: '/admin', replace: true })
  },
})

// Settings (§15): one tab per route; the old paths lead to their tab.
const adminUpdatesRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: '/updates',
  beforeLoad: () => {
    throw redirect({ to: '/admin/settings/updates', replace: true })
  },
})

const adminSettingsRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: '/settings',
  beforeLoad: () => {
    throw redirect({ to: '/admin/settings/general', replace: true })
  },
})

const adminGeneralSettingsRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: '/settings/general',
  component: GeneralSettingsPage,
})

const adminAssistantsSettingsRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: '/settings/assistants',
  component: AssistantsSettingsPage,
})

const adminUpdatesSettingsRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: '/settings/updates',
  component: UpdatesPage,
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
  beforeLoad: () => {
    throw redirect({ to: '/admin/settings/general', replace: true })
  },
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

const adminLogsRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: '/logs',
  loader: () => LogsPage.preload?.(),
  component: LogsPage,
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
  pairRoute,
  authedRoute.addChildren([
    shellRoute.addChildren([
      indexRoute,
      moviesRoute,
      seriesRoute,
      categoryRoute,
      watchlistRoute,
      tvRoute,
      itemRoute,
      profileSettingsRoute,
      accountRoute,
      shellNotFoundRoute,
    ]),
    profilesRoute,
    watchRoute,
    watchTvRoute,
    oauthAuthorizeRoute,
    adminRoute.addChildren([
      adminIndexRoute,
      adminLibrariesRoute,
      adminLibraryRoute,
      adminTvRoute,
      adminAccountsRoute,
      adminAccountRoute,
      adminReviewRoute,
      adminSessionsRoute,
      adminUpdatesRoute,
      adminSettingsRoute,
      adminGeneralSettingsRoute,
      adminAssistantsSettingsRoute,
      adminUpdatesSettingsRoute,
      adminMetadataSettingsRoute,
      adminSegmentsSettingsRoute,
      adminPlaybackSettingsRoute,
      adminServerRoute,
      adminPendingRoute,
      adminMissingRoute,
      adminHiddenRoute,
      adminJobsRoute,
      adminLogsRoute,
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
    scrollRestoration: ({ location }) => !isKeptTab(location.pathname),
  })

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createAppRouter>
  }
}
