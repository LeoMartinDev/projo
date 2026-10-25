import { Hono, type MiddlewareHandler } from 'hono'

import type { AppEnv } from './context.ts'
import type { AdminAccountsRoutes } from './routes/admin-accounts.ts'
import type { AdminPlaybackRoutes } from './routes/admin-playback.ts'
import type { AdminFsRoutes } from './routes/admin-fs.ts'
import type { AdminLibrariesRoutes } from './routes/admin-libraries.ts'
import type { AdminProfilesRoutes } from './routes/admin-profiles.ts'
import type { AdminSegmentsRoutes } from './routes/admin-segments.ts'
import type { AdminItemsRoutes } from './routes/admin-items.ts'
import type { AdminSettingsRoutes } from './routes/admin-settings.ts'
import type { AdminJobsRoutes } from './routes/admin-jobs.ts'
import type { AdminNotificationsRoutes } from './routes/admin-notifications.ts'
import type {
  AdminMissingSourcesRoutes,
  AdminSourceReviewRoutes,
  AdminSourcesRoutes,
} from './routes/admin-sources.ts'
import type { AdminSystemRoutes } from './routes/admin-system.ts'
import type { AdminUpdatesRoutes } from './routes/admin-updates.ts'
import type { AuthRoutes } from './routes/auth.ts'
import type { CatalogRoutes } from './routes/catalog.ts'
import type { EventsRoutes } from './routes/events.ts'
import type { HomeRoutes } from './routes/home.ts'
import type { ImagesRoutes } from './routes/images.ts'
import type { InvitationsRoutes } from './routes/invitations.ts'
import type { PlaybackRoutes } from './routes/playback.ts'
import type { PreviewsRoutes } from './routes/previews.ts'
import type { ProfilesRoutes } from './routes/profiles.ts'
import type { ProgressRoutes } from './routes/progress.ts'
import type { SearchRoutes } from './routes/search.ts'
import type { SegmentsRoutes } from './routes/segments.ts'
import type { SetupRoutes } from './routes/setup.ts'
import type { StreamRoutes } from './routes/stream.ts'
import type { SubtitlesRoutes } from './routes/subtitles.ts'
import type { TrickplayRoutes } from './routes/trickplay.ts'
import type { WatchlistRoutes } from './routes/watchlist.ts'

/** One sub-app per domain, built by its module. The keys are fixed: the RPC type depends on them. */
export type ApiRoutes = {
  setup: SetupRoutes
  auth: AuthRoutes
  invitations: InvitationsRoutes
  profiles: ProfilesRoutes
  events: EventsRoutes
  catalog: CatalogRoutes
  home: HomeRoutes
  search: SearchRoutes
  progress: ProgressRoutes
  watchlist: WatchlistRoutes
  playback: PlaybackRoutes
  stream: StreamRoutes
  subtitles: SubtitlesRoutes
  trickplay: TrickplayRoutes
  previews: PreviewsRoutes
  segments: SegmentsRoutes
  images: ImagesRoutes
  adminLibraries: AdminLibrariesRoutes
  adminFs: AdminFsRoutes
  adminSources: AdminSourcesRoutes
  adminSourceReview: AdminSourceReviewRoutes
  adminItems: AdminItemsRoutes
  adminSegments: AdminSegmentsRoutes
  adminSettings: AdminSettingsRoutes
  adminAccounts: AdminAccountsRoutes
  adminProfiles: AdminProfilesRoutes
  adminPlayback: AdminPlaybackRoutes
  adminMissingSources: AdminMissingSourcesRoutes
  adminJobs: AdminJobsRoutes
  adminNotifications: AdminNotificationsRoutes
  adminSystem: AdminSystemRoutes
  adminUpdates: AdminUpdatesRoutes
}

export type ApiMiddleware = {
  /**
   * Checks `Origin` on mutating requests, resolves cookie / bearer and `X-Profile-Id` into
   * `account`, `session`, `profileId`; answers 401 on every non-public route without a session.
   */
  authenticate: MiddlewareHandler<AppEnv>
  /** Guards `/admin/*`: 401 without account, 403 without the admin role. */
  requireAdmin: MiddlewareHandler<AppEnv>
}

/** Everything under `/api/v1`. Its type is the Hono RPC contract (`AppType`). */
export const createApi = ({
  routes,
  middleware,
}: {
  routes: ApiRoutes
  middleware: ApiMiddleware
}) =>
  new Hono<AppEnv>()
    .use('*', middleware.authenticate)
    .use('/admin/*', middleware.requireAdmin)
    .route('/', routes.setup)
    .route('/', routes.auth)
    .route('/', routes.invitations)
    .route('/', routes.profiles)
    .route('/', routes.events)
    .route('/', routes.catalog)
    .route('/', routes.home)
    .route('/', routes.search)
    .route('/', routes.progress)
    .route('/', routes.watchlist)
    .route('/', routes.playback)
    .route('/', routes.stream)
    .route('/', routes.subtitles)
    .route('/', routes.trickplay)
    .route('/', routes.previews)
    .route('/', routes.segments)
    .route('/', routes.images)
    .route('/admin', routes.adminLibraries)
    .route('/admin', routes.adminFs)
    .route('/admin', routes.adminSources)
    .route('/admin', routes.adminSourceReview)
    .route('/admin', routes.adminItems)
    .route('/admin', routes.adminSegments)
    .route('/admin', routes.adminSettings)
    .route('/admin', routes.adminAccounts)
    .route('/admin', routes.adminProfiles)
    .route('/admin', routes.adminPlayback)
    .route('/admin', routes.adminMissingSources)
    .route('/admin', routes.adminJobs)
    .route('/admin', routes.adminNotifications)
    .route('/admin', routes.adminSystem)
    .route('/admin', routes.adminUpdates)

export type Api = ReturnType<typeof createApi>
