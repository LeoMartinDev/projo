# projo — guide for agents

The spec is `PRODUCT.md` (it is the contract; propose a change rather than diverge). Code, logs, error messages and docs in English.

@AGENTS.md

## Commands

```bash
bun install
bun run dev          # server :8080 (DATA_DIR=.data, LOG_LEVEL=debug, --watch) + Vite :5173 (proxies /api and /health)
bun lint             # Bun's linter (bunfig.toml [lint], canary): layers, no class, no null, confined try/catch (§5.3)
bun run typecheck    # strict tsc in each workspace + runtime/
bun run test         # bun test on the whole repository (bun test <path> to target)
bun fmt              # Bun's native formatter (bunfig.toml [fmt]); bun fmt --check in CI
bun run db:generate  # Drizzle migration from the schema (see below)
bun run build:web    # apps/web/dist, served by the server with SPA fallback
bun run build:bundle # dist/app/: server.js + public/ + drizzle/ + manifest.json (runtime/README.md)
bun run e2e          # Playwright on the bundle, one server: every journey on Chromium, @webkit/@mobile smoke on WebKit (e2e/)
```

Pinned versions (`bunfig.toml`: `exact = true`). Bun: the dated canary of `packageManager`, because `bun lint` does not exist in stable (1.4.4); install it with `bun upgrade --canary` or `npm i -g bun@<version>` (what CI does). The `lint` script first checks that `bun --help` lists `lint`: a stable Bun fails with a message instead of rerunning the script in a loop. The runtime image (`runtime/Dockerfile`) stays on 1.4.4 stable. No native dependency on the server: the app is a pure JS bundle (auto-update, §16).

## Layout

```
apps/server/src/
  core/            pure domain + ports. Imports only core/ and @projo/shared
    clock.ts ids.ts logger.ts events.ts data-paths.ts   cross-cutting ports
    jobs/job.ts jobs/ports.ts                           job types (§18), JobQueue, JobRepository
    auth/principal.ts                                   AuthAccount, AuthSession
  application/     use cases (Result). Imports only core/
  infrastructure/  port adapters. Imports only core/ (+ libs, node:, bun:)
    sqlite/schema/{accounts,libraries,items,playback,ops}.ts   full Drizzle schema of §6
    sqlite/database.ts rows.ts job-repository.ts
    clock/ ids/ logger/ events/ fs/ http/ system/
  entrypoints/     everything else; the only place that wires things together
    main.ts                 composition root (startProjo): one line per module
    modules/<domain>.ts     build<Domain>Module(platform) → { routes, jobHandlers?, scheduledTasks?, stop? }
    modules/platform.ts     Platform: config, logger, clock, ids, eventBus, db, jobQueue, paths…
    http/routes/<domain>.ts        one Hono sub-app per domain
    http/error-mapping/<domain>.ts code → HTTP status
    http/api.ts app.ts context.ts errors.ts validation.ts security-headers.ts
    jobs/handler.ts runner.ts job-queue.ts scheduler.ts
apps/server/drizzle/       generated migrations (never edit by hand)
apps/server/test/support/  database (createTestDatabase, createTempDir) clock logger
                           (silentLogger, createCapturingLogger) fakes (createSequentialIds,
                           createRecordingEventBus, createRecordingJobQueue) auth (auth domain
                           fakes) auth-app (createAuthTestApp: real HTTP + auth, readUntil for
                           SSE) catalog-fixtures (insertLibrary/Item/Source, seedViewer)
                           media (generateVideo, hasFfmpeg) media-fixtures scanner-world
apps/server/test/fixtures/ file trees (parser, classifier, scanner)
apps/web/src/{app,features/<feature>,shared/{api,i18n,styles}}
packages/shared/           @projo/shared: result.ts, errors/<domain>.ts, api/<domain>.ts
```

## Rules (§5.3), checked by lint

- **Layers**: `core` → `@projo/shared` only (no package, no `node:`/`bun:`); `application` → `core`; `infrastructure` → `core`; `entrypoints` → everything. Tests follow the rules of their folder: test doubles in `apps/server/test/support/`, not in `infrastructure/`.
- **Curried factories**, no container: `const xFactory = ({ deps }: XDeps) => (input) => …`. Ports = object types of functions.
- **No class, no `null`** (neither literal nor type). `null` allowed only in `infrastructure/sqlite/`, converted at the boundary (`stripNulls`, `fromNullable`, `toNullable`, `fromIso` in `sqlite/rows.ts`). Optional properties `x?: T` (with `exactOptionalPropertyTypes`, build with `...(v === undefined ? {} : { x: v })`).
- **`Result` for every expected failure** (`ok, err, map, mapError, andThen, match, all, fromPromise, unwrapOr` from `@projo/shared`). `throw` = bug or violated invariant. **`try/catch` only in `infrastructure/`**; elsewhere `fromPromise(() => …, toError)`.
- **Errors**: `appError('domain/reason', 'english message', { context, cause })`. Each use case declares its union: `type RenameLibraryError = AppError<'library/not_found' | 'library/name_taken'>`. The `context` goes to the client (never the `cause`); outside `/api/v1/admin/*`, `respondError` strips the `*path`/`stderr` keys and absolute paths from it (§20).
- **Zod validation at the boundaries**: HTTP input (`validate`), job payload (`defineJobHandler`), JSON column (`parseJsonColumn`), external API response.
- **Synchronous** SQLite repositories (`bun:sqlite`): `.get()`, `.all()`, `.run()`, `db.transaction((tx) => …)`. ISO UTC dates in the database, `Date` in the domain. Ids: `ids.next()` (UUID v7).

## Full example: renaming a library

```ts
// core/library/library.ts — type + port
export type Library = { id: string; name: string; createdAt: Date; metadataLanguage?: string }
export type LibraryRepository = {
  findById: (id: string) => Library | undefined
  findByName: (name: string) => Library | undefined
  rename: (input: { id: string; name: string }) => Library
}

// application/library/rename-library.ts — use case
type Deps = { libraryRepository: LibraryRepository; logger: Logger }
export type RenameLibraryError = AppError<'library/not_found' | 'library/name_taken'>
export const renameLibraryFactory =
  ({ libraryRepository, logger }: Deps) =>
  async ({
    id,
    name,
  }: {
    id: string
    name: string
  }): Promise<Result<Library, RenameLibraryError>> => {
    if (libraryRepository.findById(id) === undefined)
      return err(appError('library/not_found', 'library not found', { context: { id } }))
    if (libraryRepository.findByName(name) !== undefined)
      return err(appError('library/name_taken', 'library name already used', { context: { name } }))
    logger.info('library renamed', { libraryId: id })
    return ok(libraryRepository.rename({ id, name }))
  }

// infrastructure/sqlite/library-repository.ts — adapter
const toLibrary = (row: typeof libraries.$inferSelect): Library => {
  const { id, name, createdAt, metadataLanguage } = stripNulls(row)
  return {
    id,
    name,
    createdAt: fromIso(createdAt),
    ...(metadataLanguage === undefined ? {} : { metadataLanguage }),
  }
}
export const createSqliteLibraryRepository = ({ db }: { db: Db }): LibraryRepository => ({
  findById: (id) => {
    const row = db.select().from(libraries).where(eq(libraries.id, id)).get()
    return row && toLibrary(row)
  },
  // …
})

// entrypoints/http/routes/admin-libraries.ts — route (mounted under /api/v1/admin)
export const adminLibrariesRoutes = ({
  renameLibrary,
}: {
  renameLibrary: ReturnType<typeof renameLibraryFactory>
}) =>
  new Hono<AppEnv>().patch(
    '/libraries/:id',
    validate('json', renameLibraryBodySchema),
    async (c) => {
      const result = await renameLibrary({ id: c.req.param('id'), name: c.req.valid('json').name })
      return result.ok ? c.json(toLibraryDto(result.value), 200) : respondError(c, result.error)
    },
  )

// entrypoints/modules/libraries.ts — wiring
export const buildLibrariesModule = ({ db, logger }: Platform) => {
  const libraryRepository = createSqliteLibraryRepository({ db })
  return {
    routes: adminLibrariesRoutes({
      renameLibrary: renameLibraryFactory({ libraryRepository, logger }),
    }),
  }
}

// application/library/rename-library.test.ts — unit test, in-memory adapter
test('refuses a taken name', async () => {
  const rename = renameLibraryFactory({
    libraryRepository: inMemoryLibraries([a, b]),
    logger: silentLogger,
  })
  expect(await rename({ id: a.id, name: b.name })).toMatchObject({
    ok: false,
    error: { code: 'library/name_taken' },
  })
})
```

Chain Hono methods (`new Hono<AppEnv>().get(…).post(…)`): that is what gives the RPC type. The Zod schema of the body lives in `packages/shared/api/libraries.ts` (shared with the web).

## Where to add what

| What                    | Where                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Error code              | `packages/shared/errors/<domain>.ts` (`as const` array). New domain: new file + 1 import and 1 spread in `errors/index.ts`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| HTTP status of the code | `apps/server/src/entrypoints/http/error-mapping/<domain>.ts` (mandatory: `satisfies ErrorStatusMap<…>` requires every code; new domain: 1 spread in `error-mapping.ts`). Unknown code ⇒ 500.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Shared API schema       | `packages/shared/api/<domain>.ts` (`setup auth profiles accounts invitations libraries fs catalog genres versions home search watchlist playback progress events common`). Import: `@projo/shared/api/<domain>`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Route                   | `entrypoints/http/routes/<domain>.ts`, already mounted in `http/api.ts`: `setup auth invitations profiles events catalog home search progress watchlist playback stream` under `/api/v1` (full paths in the file: `/setup/status`, `/items/:id/progress`…), `admin-libraries admin-fs admin-sources admin-accounts` under `/api/v1/admin` (`/libraries…`). Add dependencies to the factory, pass them from `modules/<domain>.ts`. **Never `.use('*')`** in a routes file (leaks to the other domains): per-route middleware or `.use('/path/*', …)`.                                                                                                                                                                            |
| Wiring                  | `entrypoints/modules/<domain>.ts` only; `main.ts` already calls them all (`auth setup profiles events playback libraries fs sources scanner catalog progress`). Dependency between modules: explicit 2nd argument (`buildLibrariesModule(platform, { playbackSessions })`: the playback module's `PlaybackSessionTerminator` port, called before any deletion of sources/items). Visible scope of a profile (§14): `buildProfilesModule(platform).visibilityScope` (`VisibilityScopeResolver`), passed to `catalog`, `progress`, `playback` (`{ visibilityScope }`); SQL queries through `infrastructure/sqlite/catalog-sql.ts` (`visible(scope)`, `CROSS JOIN` + `+x.kind`: without them, plans take seconds on 20,000 items). |
| Job handler             | In the module: `jobHandlers: { scan_library: defineJobHandler({ payload: zodSchema, concurrency: 2, run: async (payload, { signal, reportProgress, logger, job }) => Result }) }`. Merged by `mergeJobHandlers` (duplicate = crash on startup). Job types: `core/jobs/job.ts` (already all those of §18, default priorities/attempts in `jobDefaults`).                                                                                                                                                                                                                                                                                                                                                                         |
| Enqueue a job           | `JobQueue` port (`platform.jobQueue`): `enqueue({ type, payload, dedupeKey?: 'library:<id>', priority?, runAfter?, maxAttempts? })`. A `queued` job with the same key is reused; a `running` one with the same key blocks the next (1 per library). 3 retries, backoff 30 s × 2^(n-1). Retention (`purge-jobs`, operations module): `done` 7 days, `failed`/`cancelled` 30 days; do not keep a lasting reference to a job id.                                                                                                                                                                                                                                                                                                   |
| Periodic task           | In the module: `scheduledTasks: [{ name, intervalMs, initialDelayMs?, run }]` (usually `run` enqueues a job).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Clean shutdown          | In the module: `stop: () => …` (watchers, subprocesses).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Real-time event         | `platform.eventBus.publish('scan.progress', payload)`; types and audience in `packages/shared/api/events.ts`. The runner already publishes `job.updated`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Auth in a route         | `authenticate` (`http/auth-middleware.ts`) answers 401 to any non-public route without a session (public: `/setup*`, `/auth/login`, `/auth/logout`, `/invitations/*`) and 403 to a mutating request from a foreign `Origin`. In the route: `currentPrincipal(c)` → `{ account, session }`, `currentProfileId(c)` → `Result` (`profile/required` if no active profile) from `http/principal.ts`. A PIN-protected `X-Profile-Id` not unlocked by the session (`POST /profiles/:id/select`) gives 403 `profile/pin_required` (except `/auth/*`, `/profiles*`). `/admin/*`: `requireAdmin` (403 `auth/forbidden`). 204: `noContent(c)` from `http/responses.ts`.                                                                    |

Metadata (§9, M2): `metadata` module (built before `scanner`, which receives its `requestMatch`), routes `images` (`/api/v1/images/:id`), `admin-items` (`/tmdb/search`, `/tmdb/posters/:file`, `/items/:id/rematch`), `admin-settings` (`/settings`), `adminSourceReviewRoutes` of `admin-sources.ts` (`/sources/:id/assign|reject`); schemas `packages/shared/api/{metadata,settings}.ts`. TMDB client: `infrastructure/tmdb/` (injectable base URL). Writes: `items` (metadata, `content_rating`, external ids, `*_image_id`), `people`/`item_people`, `images` (files `/data/images/<kind>s/<id>.<ext>`, `profile` → `people/`), `item_manual_matches`, `tmdb_responses`. Local → TMDB merge: `moveItemRows` of `infrastructure/sqlite/metadata-item-repository.ts` (any new per-item and per-profile table must be added there). Language and country of an item (§9.1): those of the oldest library containing a file of its movie or show (`infrastructure/sqlite/item-library.ts`, the only implementation); every TMDB write passes its language to `writeMetadata` (`items.metadata_language`), language or country changes go through `refresh.queueStaleLanguage` / `queueLibraryContextChange`, each identification through `queueIfContextDiffers` (tree with mixed settings: `treeStates`), and any code that removes files from a TMDB item (library or root deletion, purge, correction, rejection) calls `filesLeaving(files)` before and the returned function after (`LibraryMetadataContextObserver` port, passed to the libraries and operations modules). Genres (§9.1): projo ids only (`genreIds` / `genreIdSchema` of `@projo/shared/api/genres`), TMDB id conversion in `core/metadata/genres.ts`, `genres.<id>` labels in the web locales (`shared/i18n/genres.ts`); never a genre name in the database or the API. Versions (§7.7) and editions (§8.1): codes from `@projo/shared/api/versions` (`editionIds`, `sourceVersionDtoSchema`), derived on read from `sources.probe` and `sources.parsed` (`core/media/version.ts`); label composed by the web (`shared/i18n/versions.ts`, `editions.<id>`).

Intros and credits (§12, M4): `segments` module (built before `metadata`, which serves its `/admin/settings` section) — `fetch_segments` chain (`application/segments/fetch-segments.ts`: manual > chapters > providers > fingerprint, priority applied by `SegmentRepository.save`), manual markers and `submit_segment`, routes `segments` (`/items/:id/segments`) and `admin-segments`; `fingerprint` module (`fingerprint_season`, `fpcalc`). Providers: `infrastructure/segments/` (TheIntroDB, IntroDB, SkipDB, quotas in `rate-limit.ts`), never the real ones in tests: `test/support/segment-providers-server.ts` replays `test/fixtures/segments/` (also in e2e through `e2e/support/tmdb-redirect.ts`). Negative marker = lookup `no_segment:<type>`, set by the admin only. E2E: `PROJO_E2E_DIR` outside a hidden folder (the file browser hides `.claude/`).

Operations (§15–16, M5): `operations` module (built before `metadata`, which serves its "Playback" and "Server" sections of `/admin/settings` through `operations.settings`) — routes `admin-jobs`, `admin-notifications`, `admin-system` (`/stats`, `/db/export`), `adminMissingSourcesRoutes` of `admin-sources.ts`; use cases typed in `application/operations/types.ts`, ports in `core/jobs/ports.ts` (`JobAdminRepository`, `JobRepository.release` for clean shutdown), `core/notifications/`, `core/stats/`. The module receives `{ playbackSessions, jobControl }` (`jobControl` = `runner.cancel`/`wake`, bound afterwards in `main.ts` like `playbackLater`); it registers `purge_missing` (daily, sources `missing` for 30 days) and the `operations-checks` task (15 min: `cache/disk_low`, `scan/needs_review_count` at most once a day). Target of a job: `jobTargetOf` (`core/jobs/target.ts`, to extend for any new type), named by `infrastructure/sqlite/job-target-labels.ts`. Dashboard counters: `infrastructure/sqlite/stats-queries.ts` (perf: `test/integration/stats-perf.test.ts`). Web: `features/admin/operations/` (dashboard on `/admin`, jobs, notifications, pending and missing files), settings one page per section (`/admin/settings/{metadata,segments,playback}`, `/admin/server`), shared tables in `admin-table.css`. `updates` module (route `admin-updates`, jobs `check_updates`/`apply_update`): `application/updates/types.ts`, `core/updates/update.ts` (`ReleaseSource`, `ReleaseInstaller`, `UpdateRepository`, `ProcessControl`, `SwitchReport`; contract with the supervisor in `runtime/README.md`). Adapters in `infrastructure/updates/` (GitHub, injectable API base and download prefix; extraction with `Bun.Archive`, no native dependency); never the real GitHub in tests: `test/support/github-releases-server.ts` (real small archives) and `updates-world.ts`. Updater active only from the bundle under the supervisor (`enabled` option in tests); `main.ts` passes `exitForSwitch` (clean shutdown like SIGTERM, then exit 75). Metadata editing (§9.3–9.4): `application/metadata/editing-types.ts` (`MetadataEditing`), `core/metadata/editing.ts`, served by `admin-items` (including `/libraries/:id/refresh-metadata`). Schemas: `packages/shared/api/{jobs,notifications,updates,system}.ts`; job and notification types live in `@projo/shared` (`jobTypes`, `notificationKinds`, titles in `admin.notifications` of the locales, checked by `errors.test.ts`).

## Migrations

1. Edit `infrastructure/sqlite/schema/<group>.ts` (`casing: 'snake_case'`: camelCase properties → snake_case columns; booleans `integer({ mode: 'boolean' })`, dates ISO `text()`, JSON `text({ mode: 'json' }).$type<unknown>()` validated by `parseJsonColumn`).
2. `bun run --cwd apps/server db:generate --name <what>` → new `drizzle/NNNN_<what>.sql` + `meta/`. Never edit an existing migration. Agents in parallel: one generation at a time, check `drizzle/meta/_journal.json`.
3. Applied on startup (`openDatabase`), with a `VACUUM INTO` copy in `/data/db/backups/` if the database exists and migrations are pending. Failure ⇒ the process exits with code 1.

Since the end of M1, migrations are **additive**: no more merging and no more regenerating `0000_init` (Léo has a real database in `.data/`). SQL Drizzle cannot express (FTS5 virtual tables, triggers): `db:generate --custom --name <what>` then write the SQL in the created file.

## Tests

- Unit tests next to the code (`x.test.ts`), `bun:test`. `core`/`application`: in-memory adapters (in the test or `test/support/`), never infrastructure.
- SQLite integration: migrated in-memory database, one per test:

```ts
import { createTestDatabase } from '../../../test/support/database.ts'
let repo: LibraryRepository
beforeEach(() => {
  repo = createSqliteLibraryRepository({ db: createTestDatabase() })
})
```

- Real files: `createTempDir()` (`cleanup()` in `afterEach`), fixtures in `apps/server/test/fixtures/`.
- Scanner and media: `test/support/scanner-world.ts` (libraries/fs/sources/scanner modules on an in-memory database, manual clock, `runJobs([...])` runs jobs by hand, `request()` = admin API), tiny videos generated on the fly by `test/support/media-fixtures.ts` (ffmpeg/ffprobe required). Integration in `test/integration/`.
- Reference ffmpeg: the image's (`runtime/Dockerfile`, Debian trixie, 7.1). CI runs `bun run test` in the image's `runtime` target and the e2e runs its server there (`PROJO_E2E_RUNTIME_IMAGE`). Locally with Docker: `docker build -f runtime/Dockerfile --target runtime -t projo-runtime .` then `docker run --rm -v "$PWD:$PWD" -w "$PWD" --entrypoint bun projo-runtime run test`. ffmpeg 6.x (Ubuntu 24.04) differs: the transcode's `trim` after a seek is not applied there.
- HTTP: `createHttpApp(...)` + `app.request('/api/v1/…')` (see `entrypoints/http/app.test.ts`); with real auth: `createAuthTestApp()` (`test/support/auth-app.ts`); full startup: `startProjo({ env: { PORT: '0', DATA_DIR: tmp, LOG_LEVEL: 'error' } })`.
- TMDB: never the real one. `test/support/tmdb-server.ts` replays `test/fixtures/tmdb/` (key `TEST_TMDB_KEY`); `test/support/metadata-world.ts` = scanner world + metadata module against that server (`setKey()`, `runJobs(['match_source', 'fetch_images'])`, `requestApi('/images/:id')`).
- Catalogue / playback without scanner: rows inserted by `test/support/catalog-fixtures.ts`; end-to-end playback: `entrypoints/http/routes/playback-flow.test.ts`.

## Misc

- Config: only `PORT`, `DATA_DIR`, `TRUST_PROXY`, `LOG_LEVEL` (`entrypoints/config.ts`). Everything else: `settings` table. `PROJO_RUNTIME_VERSION` (set by the supervisor) feeds `runtime` of `/health`.
- Logger: `logger.info('msg', { code, jobId, sessionId, error })`, JSON on stdout; `c.get('logger')` carries `requestId`.
- SSE: `Bun.serve` has `idleTimeout: 120` s ⇒ send a keep-alive at least every 30 s.
- Bundle (runtime/README.md): `server.js` with `drizzle/` (migrations), `public/` (web) and `manifest.json` next to it; `entrypoints/app-paths.ts` detects this layout.
- Web: `api` (`shared/api/client.ts`) = `hc<AppType>('/api/v1')`; only import types from `@projo/server`. Strings in `shared/i18n/{fr,en}.json` (keys typed on `fr.json`), errors translated from `error.code`.
