# projo — Product specification

> A self-hosted media server for movies and TV shows, built for a household, with the user experience as its only differentiator.
> This document bounds the project: anything not in it is not in projo. It is written to be carried out from A to Z by a developer or an agent, milestone by milestone.

Document version: 1.6 (2026-11-18: live TV from IPTV sources, §29). Product language: French first, English shipped.

---

## Contents

1. [Vision and positioning](#1-vision-and-positioning)
2. [Scope](#2-scope)
3. [Glossary](#3-glossary)
4. [Critical journeys](#4-critical-journeys)
5. [Architecture](#5-architecture)
6. [Data model](#6-data-model)
7. [Libraries and scanning](#7-libraries-and-scanning)
8. [Naming conventions table](#8-naming-conventions-table)
9. [Metadata](#9-metadata)
10. [Playback and streaming](#10-playback-and-streaming)
11. [Audio and subtitle selection](#11-audio-and-subtitle-selection)
12. [Intros, credits and segments](#12-intros-credits-and-segments)
13. [Progress, home, navigation](#13-progress-home-navigation)
14. [Accounts, profiles, authentication](#14-accounts-profiles-authentication)
15. [Administration](#15-administration)
16. [Updates from the admin](#16-updates-from-the-admin)
17. [API](#17-api)
18. [Jobs](#18-jobs)
19. [Interface, i18n, design](#19-interface-i18n-design)
20. [Security](#20-security)
21. [Non-functional](#21-non-functional)
22. [Tests and CI](#22-tests-and-ci)
23. [Milestones](#23-milestones)
24. [Default decisions](#24-default-decisions)
25. [References](#25-references)
26. [Mobile app (iOS, iPadOS)](#26-mobile-app-ios-ipados)
27. [MCP server](#27-mcp-server)
28. [Desktop app (Windows, macOS)](#28-desktop-app-windows-macos)
29. [Live TV (IPTV)](#29-live-tv-iptv)

---

## 1. Vision and positioning

projo is a **self-hosted, single-tenant** media server. One installation = one household: the person who hosts it (the admin) and the people they invite (family, friends). It plays the video files already on the disk, identifies them, and presents them in an interface that aims for the level of Netflix or the Apple TV app: beautiful, modern, simple, with no settings to understand to watch a movie.

**What projo does better than Plex and Jellyfin**: the user experience. Not more features, fewer, but each one finished. Resuming a show, skipping an intro, finding something to watch, switching profiles: everything must be obvious and fast.

**What projo copies without shame**: the naming conventions of Jellyfin and Infuse, Jellyfin's on-the-fly transcoding approach, the existing community intro databases.

**What projo is not**: a cloud service, a hosted offer, a music or photo player, a native TV app, a download or file organising tool.

---

## 2. Scope

### 2.1 In v1

- Movies and shows, identified through TMDB.
- Responsive web app (desktop, mobile, tablet), installable as a PWA, served by the server itself.
- A desktop app for Windows (§28): the web app bundled in a native window, talking to the server as an API client, playing every file directly through libmpv (MKV, HEVC and AV1 10-bit, HDR10, Dolby Vision, DTS, TrueHD, PGS, ASS), with no remux nor transcode at original quality.
- Untyped multi-folder libraries, messy content accepted, automatic per-file classification.
- Robust scanning: detection of files being written, missing files, unreachable folders, moves, multiple versions.
- Playback: direct play, remux, audio transcoding, video transcoding (software, or VAAPI as an admin option) with a quality picker and HDR to SDR tone mapping, text and burned-in subtitles, timeline thumbnails.
- Smart audio and subtitle selection, remembered per show.
- Intros and credits: skip intro, skip end credits, next episode autoplay, through community databases, local fingerprinting and manual markers.
- Per-profile progress: continue watching (one card per show: the episode in progress, else the next one), watched / unwatched, My list, video preview on the home hero.
- Accounts with login, invitations, up to 5 profiles per account with a PIN, per-profile library access and maximum content rating.
- Full administration: first-launch wizard, libraries, queues, accounts, active sessions, playback settings, metadata editing, jobs, notifications.
- Application updates from the admin page, without redeploying the container, with rollback.
- An MCP server for the admin: the "To review" queue and match fixes from Claude (Code, Desktop, connectors) or ChatGPT, with a token or OAuth 2.1 (§27).
- Live TV from the household's own IPTV sources (M3U, Xtream Codes, Freebox), relayed by the server, with a now / next guide, on the web and the desktop app (§29).
- French and English interface, dark theme.

### 2.2 Planned for v2 (not in v1, but the architecture must not make it impossible)

- Mobile app: no longer v2, specified in §26 (iPhone and iPad, milestone M6).
- Network mounts (NFS, SMB): the per-root watcher / polling strategy is already planned.
- Faithful rendering of ASS subtitles (libass in WASM).
- Subtitle download (OpenSubtitles).
- Advanced kids mode (dedicated interface, exit lock); the per-profile maximum rating is already in v1.
- Light theme.
- Per-profile watch history.
- Absolute numbering for anime and dated episodes.
- Outgoing webhooks for alerts, qBittorrent and Radarr/Sonarr integrations.
- TMDB collections, person pages, trailers.
- Playing extras (trailers, making-of).
- IPTV beyond live channels: the provider's VOD and series in the catalogue, replay (§29.10).

### 2.3 Permanently out of scope

- Multi-tenancy, billing, cloud account, relay, native HTTPS, certificate management.
- Chromecast, native TV apps (Apple TV, Android TV, Tizen, webOS). AirPlay only as the platform player provides it: the iOS app's (§26.6) and Safari's on the web (§10.7), never a feature of its own.
- Music, photos, books, unidentifiable home videos.
- Recording live TV, rewinding it further than its replay window (§29.4), tuners, radios, any bundled or suggested playlist (§29.10).
- Renaming, moving or deleting files by the app. The library is read-only.
- NFO files and local images (`poster.jpg`, `fanart.jpg`).
- Disc folders (`VIDEO_TS`, `BDMV`), ISO images, 3D files.
- Offline mode, download for offline playback.
- Connecting one client to several servers (the desktop app's "Change server", §28.3, replaces the one it has).

---

## 3. Glossary

| Term | Definition |
|---|---|
| **Account** | Sign-in identity (username + password). Role `admin` or `user`. |
| **Profile** | Viewing identity attached to an account (name, avatar, preferences). All progress is per profile. |
| **Library** | Named set of root folders sharing settings. Invisible to users, used by the admin and for access rights. |
| **Root** | An absolute folder of the container's file system, belonging to a library. |
| **Source** | A video file discovered in a root, with its lifecycle state. |
| **Item** | An identified entity: movie, show, season or episode. An item has 0..n sources. |
| **Version** | One source among several for the same item (1080p and 4K of the same movie). |
| **Part** | One source among several that, put end to end, make a single movie (`cd1`, `cd2`). |
| **Segment** | A typed time interval on an item: intro, recap, end credits, preview. |
| **Playback session** | Ongoing playback by a profile on a device, with its delivery mode. |
| **TV source** | An IPTV subscription added by the admin: an M3U playlist, an Xtream Codes account or a Freebox (§29). |
| **Channel** | A live channel of a TV source. Not an item: no TMDB identity, no progress. |
| **Job** | A persisted background task (scan, probe, matching, images, trickplay, fingerprinting, update). |
| **Runtime** | The Docker image: Bun, ffmpeg, ffprobe, fpcalc, supervisor. Versioned separately from the app. |
| **Bundle** | A version of the application (pure JS) installed in the data volume. |

---

## 4. Critical journeys

These five journeys are the ones the Playwright suite covers end to end. They define "it works".

1. **First launch**: the admin opens projo, creates their account, adds a library by picking a folder, starts the scan, sees their movies and shows appear with posters.
2. **Invitation**: the admin generates a link, another person opens it, picks their password, creates a profile, lands on the home page.
3. **Movie**: a profile starts a movie, pauses it, closes the tab, comes back, sees "Resume" at the right position, finishes the movie, the movie is marked watched and leaves "Continue watching".
4. **Show**: a profile starts an episode, the "Skip intro" button appears and works, at the end the countdown starts the next episode, the audio and subtitle tracks picked on episode 1 are kept on episode 2.
5. **Correction**: an unidentified file appears in "To review", the admin searches for the right TMDB title, assigns it, the item appears to users, a rescan does not undo the correction.

---

## 5. Architecture

### 5.1 Stack

| Layer | Choice |
|---|---|
| Runtime | Bun (latest stable version when the project starts, pinned in the image) |
| HTTP server | Hono on Bun |
| Database | SQLite through `bun:sqlite`, Drizzle ORM, Drizzle migrations |
| Validation | Zod, schemas shared between server and web |
| API client | Hono's typed RPC (`hc`) from the server app's type |
| Web | Vite, React, TanStack Router, TanStack Query, hls.js |
| Player logic (§10.7) | `@projo/player`: pure TypeScript, no DOM, no React, driven through a `PlayerEngine` port (web `<video>` + hls.js, libmpv in the desktop app, later `expo-video`) |
| Mobile (§26) | Expo (React Native), Expo Router, TanStack Query, `expo-video` (AVPlayer) |
| Desktop (§28) | Tauri 2 (Rust, WebView2 on Windows), libmpv through projo's own binding (`libloading`) |
| Real time | SSE (Server-Sent Events), one stream per authenticated client |
| Media | `ffmpeg`, `ffprobe`, `fpcalc` (Chromaprint) called as subprocesses |
| Jobs | In-process queue, persisted in SQLite, no Redis |
| Tests | `bun test`, Playwright |
| CI | GitHub Actions |
| Delivery | Runtime Docker image `ghcr.io/leomartindev/projo` + app bundles on GitHub Releases |

### 5.2 Monorepo

```
projo/
  apps/
    server/            # API, jobs, scanner, streaming
      src/
        core/          # pure domain: types, invariants, pure functions, ports, errors
        application/   # use cases
        infrastructure/# adapters: sqlite, ffmpeg, tmdb, fs, segments, clock, logger
        entrypoints/   # http, jobs, cli, composition root (main.ts)
      drizzle/         # migrations
      test/
        fixtures/      # file trees for the parser, classifier, scanner
    web/               # browser host of @projo/web-app: index.html, public/, Vite config
      src/             # main.tsx, browser-host.ts (its AppHost), app-update/ (update source), service-worker/
    mobile/            # iPhone and iPad app, Expo (§26)
      src/             # same layout as the web app: app, features, shared
      modules/         # native code (Expo Modules, Swift), the only exception to §5.3
    desktop/           # Windows app, Tauri 2 (§28)
      src-tauri/       # Rust: window, tray, server URL, token (Credential Manager, keychain), libmpv binding, IPC; lib/ holds libmpv-2.dll (not committed)
      web/             # the bundled UI (Vite, React): the screens before the app, then @projo/web-app with the desktop host
  packages/
    shared/            # Result, error codes, Zod schemas, naming conventions, API types
    i18n/              # fr/en strings and pure label helpers, shared by web and mobile (§26.2)
    design/            # fonts, tokens, base stylesheet and backdrops of web, www and mobile
    player/            # @projo/player: playback logic shared by every player (§10.7)
      src/
        core/          # MediaState and its reducer, PlayerEngine port, pure playback rules
        application/   # createPlayerController and its ports (PlaybackApi, Timers, Clock, KeyValueStorage)
        testing/       # fake engine, engine contract suite
    web-app/           # @projo/web-app: the React web application, mounted by a host
      src/
        host.ts        # AppHost port: everything host-specific (server origin, requests, events, session, engine, updates…)
        mount.tsx      # mountApp(container, host)
        desktop/       # desktop-only (Tauri): window controls, update source, About rows; exported for the desktop host
        features/      # home, browse, item, player, profiles, settings, admin, auth
          player/
            engines/   # html-video (<video> + hls.js), mpv (Tauri bridge, exported for the desktop host): PlayerEngine adapters
            ui/        # PlayerPage and its components, on the controller of @projo/player
        shared/        # components, hooks, API client, i18n
  runtime/             # Dockerfile, supervisor, image scripts
  design/              # the reference design (provided by Léo), visual source of truth
  e2e/                 # Playwright
  PRODUCT.md
  README.md
```

The web application's React code (pages, shell, layout, player UI) lives in `@projo/web-app`, so that more than one host can mount it without one app importing another: `apps/web`, the browser host, and the desktop app (§28). Everything that differs between them is a field of `AppHost`, and the package never tests which host it runs in:

| `AppHost` | Browser (`apps/web`) | Desktop app (§28) |
|---|---|---|
| `serverOrigin` | `''`: the page is the server's, URLs stay root-relative | the saved server's origin |
| `apiFetch(path, init)` | `fetch`, session cookie | `fetch` to the server with `Authorization: Bearer` |
| media URLs (`<img>`, `srcset`, CSS `url()`, `<video>`) | the path | absolute, with the session's media key (`mediaKey` of `/auth/me`, §20), joined by the app |
| `openEvents(events)` | `EventSource` | a `fetch` stream with the bearer (`createFetchEvents` of the package): a 401 ends the session (`events.unauthorized`), other refusals back off |
| `download(path, filename)` | a link | `fetch` with the bearer, then a blob |
| `sendLeave(path, body)` (last heartbeat, §10.6) | `sendBeacon` | a `keepalive` `fetch` with the bearer |
| `session` | `cookie` | `token`: sign-in sends `token: true` and `deviceName`, the host keeps the token; sign-out and a 401 drop it |
| `playerEngine()` (§10.7) | `html-video` | `mpv` (`@projo/web-app/engines/mpv`), `html-video` as fallback |
| `chrome` | none (an old desktop app: the window buttons, transitional, §28.1) | the window buttons (§28.4), clear of pages through `--chrome-inset` |
| `updates` (§16.4) | the server's version against the build's, service worker, `reload` | the desktop app's own update, `restart` (§28.10) |
| `aboutRows` | none (an old desktop app: its version, transitional, §28.1) | the desktop app's version |
| `systemMedia` (Now Playing, §10.7): `set`, `position`, `clear`, `onAction` | the Media Session API (`navigator.mediaSession`) | Windows' system media controls over IPC (`media_session_*`, `media://action`, §28.7) |
| `version`, `reloadToLatest`, `reloadFresh` | the build's version, service-worker reloads | the bundle's version, plain reloads |
| `uiFromServer` | `true`: the app follows the server's version (Admin → Updates compares them and offers "Reload the app") | `false`: the UI ships with the app (§28.10); Admin → Updates shows the desktop app's version instead |

Components reach the host through `useHost()`; module-level pieces (the API client, the event hub, media URLs) through the host `mountApp` binds before rendering. Desktop-only code (Tauri, libmpv) sits apart in the package (`src/desktop/`, `engines/mpv/`), reached only through its exports: the browser bundle carries none of it.

### 5.3 Non-negotiable code rules

These rules apply to projo's code (not to third-party libraries). They are checked by lint from milestone M1 and a violation blocks CI.

**Layers and dependency rule** (server):

| Layer | Contains | May import |
|---|---|---|
| `core/` | Domain types, invariants, pure functions (name parser, classifier, track cascade, "watched" rule), **ports** (interfaces to the outside world), domain errors | nothing but `packages/shared` |
| `application/` | Use cases: functions that orchestrate ports and return a `Result` | `core` |
| `infrastructure/` | Adapters implementing the ports: SQLite repositories, ffmpeg, ffprobe, fpcalc, TMDB client, segment providers, file system, watcher, clock, logger, outgoing HTTP | `core` |
| `entrypoints/` | Hono routes and Zod validation, error to HTTP mapping, SSE, job scheduler and workers, CLI, **composition root** | `application`, `core`, `infrastructure` |

A `bun lint` rule (`import/no-restricted-paths`) enforces this table.

**Dependency injection through curried factories, without a container.** A use case, an adapter, a handler: all follow the same shape. The factory receives the dependencies and returns the function that receives the input.

```ts
// application/library/scan-library.ts
export const scanLibraryFactory =
  ({ fileSystem, sourceRepo, clock, logger }: ScanLibraryDeps) =>
  async ({ libraryId }: ScanLibraryInput): Promise<Result<ScanReport, ScanLibraryError>> => {
    // ...
  }

// entrypoints/main.ts (composition root)
const scanLibrary = scanLibraryFactory({ fileSystem, sourceRepo, clock, logger })
```

Ports are object types of functions (`type SourceRepository = { findByPath: ..., save: ... }`). The in-memory adapters used by tests implement the same types.

**No classes.** Factories, plain objects, closures. `bun lint` rule: `no-restricted-syntax` on `ClassDeclaration` and `ClassExpression`.

**No `null`.** `undefined` for optional values (`T | undefined`), `exactOptionalPropertyTypes` enabled. SQLite `NULL`s are converted to `undefined` in the repositories, never beyond. `bun lint` rule: `no-restricted-syntax` on the `null` literal, with an explicit exception in `infrastructure/sqlite/`. No `Option` type: `T | undefined` is enough.

**`Result` everywhere for expected failures.** Home-made type in `packages/shared`:

```ts
export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E }
// helpers: ok, err, map, mapError, andThen, match, all, fromPromise, unwrapOr
```

No exception for an expected failure (missing file, TMDB without results, wrong password, quota exceeded). `throw` is reserved for bugs and violated invariants. `try/catch` only exists in `infrastructure/`, to turn what ffmpeg, the file system or `fetch` throw into a `Result`. No third-party `Result` library.

**Errors done right.** An error is a plain object, never a generic `Error`:

```ts
type AppError<Code extends string = string> = {
  code: Code                       // 'library/root_unreachable'
  message: string                  // sentence for the logs, in English
  context?: Record<string, unknown>
  cause?: unknown
}
```

Codes are stable `domain/reason` strings, declared in `packages/shared/errors.ts`, shared with the web for message translation. Each use case declares the exact union of codes it can produce: `ScanLibraryError = AppError<'library/not_found' | 'library/root_unreachable'>`. A single table in `entrypoints/http/error-mapping.ts` maps each code to an HTTP status; a code missing from the table is a bug and gives 500.

**On the web**: same bans (classes, `null`), same `Result` for API calls, same error codes for messages. Organised by feature, no layers: the front end has no domain to protect. The player is the exception: its logic is shared by several engines and apps, so it lives in a package with layers, and the web player keeps engines and interface apart.

**Layers of the player** (§10.7):

| Layer | Contains | May import |
|---|---|---|
| `packages/player/src/core/` | `MediaState`, `MediaEvent` and the pure reducer `MediaState × MediaEvent → MediaState`, the `PlayerEngine` port and `EngineCapabilities`, the pure playback rules (timeline, segment skip, next up, track memory, trickplay index, seek stall, heartbeat schedule, session ends and requests, playlist wait) | `@projo/shared` |
| `packages/player/src/application/` | `createPlayerController({ engine, api, clock, timers, storage, … })` → a store (`subscribe`, `get`) and its actions; ports for the outside world (`PlaybackApi`: create, heartbeat and end a session, track preferences…; `Timers`; `Clock`; `KeyValueStorage`) | `core` |
| `packages/player/src/testing/` | `fake-engine.ts` (a scripted engine replaying `MediaEvent` sequences), `engine-contract.ts` (the conformance suite every engine passes) | `core`, `bun:test`; imported by tests only |
| `packages/web-app/src/features/player/engines/<engine>/` | `PlayerEngine` adapters: `html-video` (`<video>`, hls.js, Picture-in-Picture, AirPlay, native full screen, `MediaSource`/`decodingInfo` probing, HLS text tracks), `mpv` (the Tauri bridge of §28.6, loaded by dynamic import only, and `mpv-events.ts`, pure: mpv property or event → `MediaEvent`) | `@projo/player`, the web's `shared/`; never another engine, never `ui/` |
| `packages/web-app/src/features/player/ui/` | `PlayerPage` and its components: read the controller's store, act through its actions, decide on `EngineCapabilities` (never on an engine's name) | `@projo/player`, the web's `shared/`; never `engines/` |
| the player route (composition) | the only place that asks for the engine, once per page: the host picks it (`AppHost.playerEngine`, §5.2: `html-video` in the browser, `mpv` in the desktop app, which reaches it through `@projo/web-app/engines/mpv`; never in the browser bundle) | everything above |

`@projo/player` imports nothing but itself, `@projo/shared` and `bun:test`: no DOM, no `fetch`, no `window` or `document`, no React or React Native, and nothing Hermes lacks (`Intl.DisplayNames`, `Intl.Locale`, `Intl.RelativeTimeFormat`, `Array.prototype.toSorted`), since the iOS app will run it (§26.6). `bun lint` checks it: `no-restricted-imports` on `packages/player/**` (relative, `@projo/shared`, `bun:test`), and `import/no-restricted-paths` zones `core/` ↛ `application/`, `packages/player` ↛ `apps/`, `packages/web-app` ↛ `apps/`, `ui/` ↛ `engines/`, `engines/mpv` ↮ `engines/html-video`, the package's other paths ↛ `engines/mpv/` and `src/desktop/`, `apps/web` ↛ both (zone and `no-restricted-imports`). Classes and `null` are banned there as everywhere.

**Validation at the boundaries.** Every HTTP input, every job payload, every external API response goes through a Zod schema before entering `application`.

### 5.4 Data on disk and configuration

A single volume, mounted on `/data`:

```
/data/
  db/projo.db                 # SQLite (+ WAL)
  db/backups/                 # copies before migration (the last 2) and before a version switch (the last one)
  images/{posters,backdrops,logos,stills,custom}/
  cache/transcode/<session>/  # HLS segments, deleted at the end of the session
  cache/trickplay/<source>/   # sprites and index
  cache/subtitles/<source>/   # tracks extracted as WebVTT
  cache/keyframes/<source>.json
  cache/previews/<item>.mp4   # hero video previews (§13.3), + <item>.json (origin source)
  app/
    current -> versions/1.4.0
    versions/1.4.0/ versions/1.3.2/
    staging/
  logs/logs.db                # lines kept for the log viewer (§15); stdout remains the main output
```

Environment variables, the only ones:

| Variable | Default | Role |
|---|---|---|
| `PORT` | `8080` | HTTP port |
| `DATA_DIR` | `/data` | volume root |
| `TRUST_PROXY` | `false` | honour `X-Forwarded-*` (behind a reverse proxy) |
| `LOG_LEVEL` | `info` | log level |

Everything else (server name, language, TMDB key, transcoding, updates, segment providers) lives in the `settings` table and is set in the admin.

Backup = copy `/data` while running (SQLite in WAL mode supports copying, the admin also offers "Export the database" which runs a `VACUUM INTO`).

---

## 6. Data model

SQLite, Drizzle. Ids: UUID v7 (sortable by date) as text. Dates in ISO 8601 UTC. `json` columns are text columns validated by Zod when read.

### 6.1 Accounts and profiles

| Table | Main columns |
|---|---|
| `accounts` | `id`, `username` (unique, case-insensitive), `password_hash` (argon2id), `role` (`admin` \| `user`), `created_at`, `disabled_at?` |
| `invitations` | `id`, `token_hash`, `created_by`, `expires_at`, `used_at?`, `used_by_account_id?` |
| `profiles` | `id`, `account_id`, `name`, `avatar_color` (`slate` \| `blue` \| `honey` \| `sage` \| `terracotta` \| `violet`), `pin_hash?`, `max_content_rating?` (maximum rating, empty = no limit), `library_access` (`all` \| `selected`), `ui_locale` (`fr` \| `en`), `audio_language`, `subtitle_language`, `subtitle_mode` (`never` \| `always` \| `when_audio_differs` \| `forced_only`), `anime_original_audio` (bool), `autoplay_next` (bool), `auto_skip_intro` (bool), `auto_skip_credits` (bool), `created_at` |
| `profile_libraries` | `profile_id`, `library_id` (used when `library_access = selected`) |
| `sessions` | `id`, `account_id`, `kind` (`cookie` \| `bearer`), `token_hash`, `device_name`, `user_agent`, `last_profile_id?`, `created_at`, `last_seen_at`, `expires_at`, `revoked_at?` |
| `pairings` | `id`, `account_id`, `created_by_session_id`, `code_hash`, `created_at`, `expires_at`, `claimed_at?`, `claimed_session_id?` (§14, §26.3) |
| `assistant_tokens` | `id`, `account_id`, `profile_id`, `kind` (`token` \| `oauth`), `client_id?`, `name`, `token_hash?` (kind `token`), `created_at`, `last_used_at?`, `revoked_at?`: the assistants of the MCP server (§27.3) |
| `oauth_clients` | `id`, `client_id` (unique: a CIMD URL, or generated by registration), `kind` (`cimd` \| `dcr`), `name`, `redirect_uris` (JSON), `created_at`, `fetched_at?`, `last_used_at?` |
| `oauth_codes` | `code_hash`, `client_id`, `account_id`, `profile_id`, `redirect_uri`, `code_challenge`, `scope`, `expires_at`, `used_at?` |
| `oauth_tokens` | `token_hash`, `assistant_id`, `kind` (`access` \| `refresh`), `expires_at`, `rotated_at?` |

Constraints: 1 to 5 profiles per account; deleting an account deletes its profiles, sessions, progress, lists and preferences.

### 6.2 Libraries and sources

| Table | Main columns |
|---|---|
| `libraries` | `id`, `name`, `hint` (`auto` \| `movies` \| `series`), `scan_interval_minutes` (default 15), `watch_enabled` (default true), `quiet_period_seconds` (default 120), `detect_segments` (default true), `pre_extract_subtitles` (default false), `trickplay_enabled` (default true), `metadata_language?` (empty = server setting), `rating_country` (default `FR`), `created_at` |
| `library_roots` | `id`, `library_id`, `path`, `state` (`ok` \| `unreachable`), `last_scan_at?`, `last_file_count`, `last_error?` (reason from §7.5 while `state = unreachable`: `not_found` \| `not_directory` \| `io_error` \| `empty` \| `no_media`; the English message goes to the logs; a text written by an earlier version is ignored when read and replaced on the next scan) |
| `sources` | `id`, `library_id`, `root_id`, `relative_path`, `extension`, `state` (`pending` \| `ready` \| `missing` \| `rejected`), `pending_reason?` (`growing` \| `probe_failed` \| `decode_failed` \| `too_small`), `size_bytes`, `mtime` (real: raw `mtimeMs`, compared with strict equality), `inode?`, `discovered_at`, `pending_since?` (entry into `pending`, for the "pending since" alert), `unchanged_since?` (since when size and mtime have not moved, for the quiet period), `stable_since?`, `ready_at?`, `missing_since?`, `probe?` (json: duration, container, video, audio and subtitle streams, chapters), `signature?` (size + duration + stream fingerprint), `classification` (`movie` \| `episode` \| `unknown`), `parsed` (json: title, year, show, season, episode, end episode, edition (`edition`, id from §8.1, or `editionName`, text of an `{edition-…}` tag), part, id tags), `match_state` (`unmatched` \| `matched` \| `manual` \| `needs_review`), `review_reason?` (codes from §7.8), `version_label?` (no longer written or read since the `edition_ids` migration: the §7.7 version is derived from `probe` and `parsed`), `stack_group_id?`, `part_index?` |
| `source_items` | `source_id`, `item_id` (several rows for a multi-episode file) |
| `source_subtitles` | `id`, `source_id`, `kind` (`external` \| `embedded`), `path?` (external), `stream_index?` (embedded), `language?`, `forced`, `sdh`, `is_default`, `format`, `title?` |
| `scan_runs` | `id`, `library_id`, `kind` (`watch` \| `periodic` \| `manual_quick` \| `manual_full` \| `startup` \| `initial`: first scan, full, when the library is created), `started_at`, `finished_at?`, `stats` (json: discovered, pending, ready, missing, errors), `error?` |

### 6.3 Items and metadata

| Table | Main columns |
|---|---|
| `items` | `id`, `kind` (`movie` \| `series` \| `season` \| `episode`), `parent_id?`, `tmdb_id?`, `imdb_id?`, `tvdb_id?`, `title`, `original_title?`, `sort_title`, `year?`, `overview?`, `release_date?`, `runtime_minutes?`, `genres` (json: array of §9.1 genre ids, never names), `original_language?`, `vote_average?`, `content_rating?`, `content_rating_country?` (country of the rating: the library's, or US as a fallback; absent on rows enriched before M2 = country of the source's library), `series_status?` (`in_production` \| `ended` \| `canceled`; absent: TMDB status unknown or local show), `last_air_date?` (shows: end of "2023 – 2025"), `season_number?`, `episode_number?`, `air_date?`, `episode_count_tmdb?` (on season and show), `poster_image_id?`, `backdrop_image_id?`, `logo_image_id?`, `still_image_id?`, `added_at` (date of the first ready source), `metadata_refreshed_at?`, `metadata_language?` (BCP 47 language TMDB answered in at the last metadata write, seasons and episodes included; absent on a local item; `item_metadata_language` migration: the language the item resolves to at that time), `created_at`, `updated_at` |
| `item_overrides` | `item_id`, `field` (`title` \| `year` \| `overview` \| `genres` \| `poster_image_id` \| `backdrop_image_id`), `value` (json; for `genres`, an array of genre ids). A row existing = locked field. |
| `manual_matches` | `library_id`, `relative_path` (key: library + relative path), `signature?`, `source_id?` (last source it applied to, cleared if the source is purged), `tmdb_id`, `kind`, `season_number?`, `episode_number?`, `created_by`, `created_at`. Memory of corrections, checked before any automatic matching; independent of the `sources` rows (a purge does not lose it). |
| `images` | `id`, `kind` (`poster` \| `backdrop` \| `logo` \| `still`), `origin` (`tmdb` \| `custom`), `tmdb_path?`, `local_path`, `width`, `height`, `language?` |
| `people` | `id`, `tmdb_id`, `name`, `profile_image_id?` |
| `item_people` | `item_id`, `person_id`, `role` (`cast` \| `director` \| `writer`), `character?`, `order` |

Visibility: a movie or an episode is **visible** if it has at least one `ready` source. A season is visible if it has a visible episode, a show if it has a visible season. Anything invisible does not exist for the user API.

Generic titles: a season or an episode whose name is only its number (`Saison 2`, `Season 2`, `Specials`, `Épisodes spéciaux` for season 0, `Episode 7`, `Épisode 7`… in fr, en and the common TMDB languages) has **no title of its own**. Nothing is made up on write (local scan, TMDB, "Back to the TMDB value"): `title` is `''` (NOT NULL column) and the API omits `title`. Detection is a single pure function (`core/catalog/generic-titles.ts`), also applied on read: older rows carrying such a name read without a title, without a migration. A real name is kept (`Book One: Water`, `Pilot`), as is a generic name of another number (`Episode 1050` on S21E5). The web then shows `Season 2` / `Episode 7` in the interface language (§19). Search (§13.5) only covers movies and shows: it is not affected.

### 6.4 Playback and progress

| Table | Main columns |
|---|---|
| `playback_progress` | `profile_id`, `item_id`, `position_ms`, `duration_ms`, `watched` (bool), `watched_at?`, `play_count`, `last_played_at`, `hidden_from_continue` (bool) |
| `watchlist` | `profile_id`, `item_id`, `added_at` |
| `track_preferences` | `profile_id`, `item_id` (show or movie), `audio_language?`, `subtitle_language?`, `subtitles_enabled` (bool), `updated_at` |
| `playback_sessions` | `id`, `profile_id`, `session_id` (auth), `source_id`, `item_id`, `mode` (`direct` \| `hls_remux` \| `hls_transcode`), `quality?`, `audio_stream?`, `audio_delivery?` (`copy` \| `aac`: the remux audio decision, kept to survive a restart), `subtitle_stream?`, `burn_in` (bool), `stream_secret_hash` (§20), `started_at`, `last_heartbeat_at`, `position_ms`, `ended_at?` |
| `segments` | `id`, `item_id`, `type` (`intro` \| `recap` \| `credits` \| `preview`), `start_ms`, `end_ms`, `origin` (`manual` \| `chapter` \| `theintrodb` \| `introdb` \| `skipdb` \| `fingerprint`), `confidence?`, `created_at` |
| `segment_lookups` | `item_id`, `provider`, `checked_at`, `outcome` (`found` \| `none` \| `no_segment` \| `error`) |
| `segment_submissions` | `id`, `item_id`, `type`, `provider` (`theintrodb` \| `skipdb`), `start_ms`, `end_ms`, `outcome` (`submitted` \| `failed`), `error?`, `submitted_at` (§12.5) |

### 6.5 Operations

| Table | Main columns |
|---|---|
| `jobs` | `id`, `type`, `payload` (json), `dedupe_key?`, `priority` (integer), `state` (`queued` \| `running` \| `done` \| `failed` \| `cancelled`), `attempts`, `max_attempts`, `run_after`, `started_at?`, `finished_at?`, `progress?` (0..100), `error?` (json AppError) |
| `notifications` | `id`, `kind`, `severity` (`info` \| `warning` \| `error`), `title_key`, `context` (json), `created_at`, `read_at?`, `resolved_at?` |
| `settings` | `key`, `value` (json), `updated_at` |
| `app_versions` | `version`, `installed_at`, `state` (`current` \| `previous` \| `failed` \| `staged`), `runtime_min` |
| `update_runs` | `id`, `kind` (`update` \| `rollback`), `from_version`, `to_version`, `requested_at`, `finished_at?`, `outcome` (`pending` \| `succeeded` \| `failed` \| `rolled_back`), `error?` (json). The update log (§15). |

---

## 7. Libraries and scanning

### 7.1 Model

- A library = name + 1..n roots + settings. No type: the design's "Add a library" screen offers "Content type" with Auto (mixed, default), Movies, Shows; that is the `hint`. "Home videos" does not exist (out of scope).
- Per-library settings, all visible on the design's creation screen: watch folders (watcher), scan interval, quiet period, detect intro and credits (`detect_segments`), extract embedded subtitles during analysis (`pre_extract_subtitles`, otherwise on first playback), generate playback bar previews (`trickplay_enabled`), metadata language (empty = server setting), country for ratings (`rating_country`, default FR), profiles with access.
- A file belongs to exactly one library (its root's). Two roots cannot overlap, within the same library or across libraries (validated on creation).
- Roots are absolute container paths. The admin picks them through a server-side file browser (navigation from `/`, folders only) or by typing the path.
- The `hint` steers the classifier (§8.2 "Classification"): `movies` forces the movie classification for any file whose name has no explicit episode pattern; `series` forces episode; `auto` lets it decide. Changing it reads every name of the library again (full scan).
- Users never see libraries. They see **Movies** and **Shows** aggregated over the libraries their profile can access, filtered by the profile's maximum rating.

### 7.2 Pipeline of a source

```
discovery → filter → quarantine (pending) → stability → probe → ready
   → classification → parsing → matching → enrichment → visible
```

| Step | What happens | Result |
|---|---|---|
| Discovery | Recursive walk of a root, or a watcher event | path, size, mtime, inode |
| Filter | Accepted video extension, not excluded (§8.6), not an extra (§8.5), size ≥ 1 MB | ignored or candidate |
| Quarantine | New source, or source whose (size, mtime) changed: `state = pending`, `pending_reason = growing` | invisible |
| Stability | See §7.3 | `stable_since` set |
| Probe | `ffprobe` + sample decoding (§7.3) | `probe`, `signature`, `state = ready` |
| Classification | `movie` / `episode` / `unknown` from the path, the name and `hint` | `classification` |
| Parsing | Extraction of title, year, show, season, episode(s), edition, part, id tags (§8) | `parsed` |
| Matching | Manual corrections memory, then TMDB (§9.2) | `source_items`, `match_state` |
| Enrichment | Images, cast, then low-priority jobs: keyframes, trickplay, segments | visible item |

Each step is an idempotent job (§18). A source can replay a step without side effects.

### 7.3 Detecting a file being written

The problem: a torrent client or a network copy writes the file in place for minutes or hours. It must never appear to users before it is complete and readable.

Algorithm, in order:

1. **Extension filter.** Only the `mkv mp4 m4v mov avi webm ts m2ts wmv` extensions are candidates. Ignored outright: `.part .!qB .!qb .crdownload .tmp .partial .aria2 .download .bak`, any file whose name starts with `.` or `._`.
2. **Quarantine.** Any new source, or one whose size or mtime changed since the last pass, is `pending` with the reason `growing`.
3. **Stability.** A `watch_pending` job re-stats only `pending` sources (stat only, no read): started at the end of each scan that leaves `pending` sources, then rescheduled at the nearest known deadline (end of a source's quiet period, at the earliest 2 s), a single job thanks to deduplication; the 30 s tick remains the safety net. With a quiet period of 0, a complete file is ready as soon as the scan ends. If size or mtime changes, the counter restarts. When size **and** mtime are unchanged for the library's **quiet period** (default 120 s), `stable_since` is set. The mtime is essential: qBittorrent with pre-allocation creates the file at its final size from the start, only the mtime moves afterwards.
4. **Integrity probe.** `ffprobe -v error -show_format -show_streams -show_chapters -of json`. Conditions: duration > 0, at least one video stream. An MP4 being written does not have its `moov` atom yet and fails here (`pending_reason = probe_failed`). Then **sample decoding**: three 2 s decodes (`ffmpeg -v error -ss <t> -i <f> -t 2 -f null -`) at 10 %, 50 % and 90 % of the duration; any decoding error sends it back to `pending` with `decode_failed`. This test catches the paused torrent that leaves an MKV full of zeros, which passes stability and ffprobe.
5. **Ready.** `state = ready`, `ready_at = now`, the source moves on to classification. A `pending` source is re-stated at each cycle; one whose probe or decoding failed (`probe_failed`, `decode_failed`) is probed again only when its size or mtime changes (quarantine again), on a full scan or through the admin's "Recheck", never at each periodic scan (an unchanged broken file fails again, and each attempt costs a probe and three decodes). After 24 h in `pending` (configurable), an admin notification `scan/source_stuck_pending` is emitted, once per source.

Documented recommendations for the host (README): enable the `.!qB` extension for incomplete files in qBittorrent, and let Radarr/Sonarr import finished files (atomic arrival). In both cases the quarantine is nearly instant.

A `ready` source whose size or mtime changes again (file replaced by an upgrade) goes back to `pending`, becomes invisible again, and keeps its `item_id`: when leaving quarantine, if probing and parsing give the same result, it takes its place back without re-matching.

### 7.4 Scan triggers

Three triggers, a single scan per library at a time, concurrent requests coalesce into a single follow-up run.

| Trigger | When | Scope |
|---|---|---|
| Watcher | Recursive `fs.watch` on each root, if `watch_enabled` | Queues the touched paths and moves the next incremental scan to "now + 5 s" (debounce). Never authoritative on its own. |
| Periodic incremental | Every `scan_interval_minutes` (default 15) | Walks the folders; only goes down into those whose mtime changed since the last scan or that are unknown. Compares the files found with the `sources` table. |
| Manual | Admin button per library: "Scan" (incremental) or "Full scan" (read everything again, names included, reclassified if the parser changed, re-probe sources whose signature changed, retry matching of `unmatched` ones) | |
| Startup | When the server starts | Incremental scan of all libraries, after 10 s; a full scan instead (kind `rules_update`) when the name analysis rules changed since the last start (a version number of the parser, stored in `settings`) |

A full scan reads every name again. A file whose new reading changes its classification (movie ↔ episode) loses an automatic identification and is identified again from its new reading; a manual correction keeps its classification and its identification.

The watcher can be turned off per library, and will be off by default on network mounts in v2 (detected by FS type).

### 7.5 Deletions, missing files, unreachable roots

- Source absent during a scan: `state = missing`, `missing_since = now`. The item becomes invisible immediately if it has no `ready` source left. Nothing else is deleted: progress, My list, preferences, manual corrections, images remain.
- A `missing` source that reappears at the same path: back to `ready` (or `pending` if size or mtime changed), without loss.
- Automatic purge of `missing` sources after 30 days (configurable) by the `purge_missing` job; manual purge possible in the admin, per source or in bulk. The purge deletes the source; the item is deleted if it has no source, no manual correction (identification or edited field) and no history of any profile left (progress, My list, track preferences), otherwise it stays (invisible), its parents too. A file back after the purge is a new source: matching lands on the same TMDB item, which finds its history again.
- **Many files missing at once**: the root guard cannot see a disk or a share gone below a root (mergerfs, Unraid, one mount per disk). When a scan turns at least 20 files missing that are at least 10 % of the library's files (hidden ones excepted), the files still turn missing, and the notification `scan/many_missing` (one per library) gives their count and the deepest folder they share (in the root that lost the most). It is resolved by a later scan once the library's missing files are below these thresholds again (files back or purged).
- **Unreachable root safeguard**: before marking anything `missing`, the scan checks the root. If the folder does not exist, returns an I/O error, is not a folder, or no longer contains any video (empty or not) while `last_file_count > 0`, the scan of that root is **cancelled**, `library_roots.state = unreachable` with its reason in `last_error` (`not_found`, `io_error`, `not_directory`, `empty`, `no_media`, labelled by the web), notification `library/root_unreachable`, and no source is modified. On the next scan, if the root answers again, `state = ok` and the scan resumes normally.

### 7.6 Moves and renames

The identity that matters is the item, not the file. Progress is on (profile, item). A file renamed by Radarr lands on the same TMDB item and loses nothing.

To avoid a useless re-matching, when a scan sees a path disappear and another one appear in the same library:

1. Same `inode` and same size (local disk): a move, `relative_path` is updated, the source keeps its id and its state.
2. Otherwise same `signature` (size, duration to the millisecond, list of streams): same.
3. Otherwise: new source, full pipeline; the old one becomes `missing`. If matching lands on the same item, progress is intact anyway.

### 7.7 Multiple versions and parts

- **Versions**: every source matched to the same item (movie or episode) is a version of that item. Grouping is by TMDB identity, not by file name prefix. What distinguishes a version is sent as codes (`version`, `sourceVersionDtoSchema` of `packages/shared/api/versions.ts`), derived on read from the main video stream of `probe` and from `parsed`: `resolution` (`2160p`, `1080p`, `720p`, `SD`), `dynamicRange` (`sdr`, `hdr`, `dv`), `videoCodec` (ffprobe `codec_name`), `edition` (id from §8.1) or `editionName` (text of a tag). The label is composed by the web in the interface language: `2160p HDR HEVC · Extended Edition` (`HDR`/`DV`, nothing for SDR); two versions of an item with the same label get their number appended (`1080p H.264 · Version 2`), a version with nothing known is `Version 3`.
- Default playback: the best version playable **without video transcoding** on the current device (§10.2), failing that the highest resolution. A version picker is in the player.
- "Best" = resolution, then HDR/DV, then total size; a version in parts is a single entry (its first part). A session's `sourceId` can be any part: it picks the version, the position picks the part.
- **Parts** (`cd1`, `part2`, `disc1`, `pt-a`): sources in the same folder that match the stacking pattern (§8.1) and the same title form a `stack_group_id`, ordered by `part_index`. The item is unique; the player chains the parts like a next episode, without a countdown; progress is stored as a cumulative position.

### 7.8 Unidentified files and the "To review" queue

A source becomes `match_state = needs_review` with a `review_reason` when:

- `classification = unknown` (`classification_ambiguous`);
- TMDB returns nothing (`no_match`);
- two TMDB candidates have too close a score (`ambiguous_match`);
- the show is found but not the season or episode (`episode_not_found`);
- absolute numbering on a show with several seasons (`absolute_numbering`);
- dated episode (`date_based`);
- an explicit episode pattern in a `movies` library (`hint_conflict`);
- an episode without an episode number (`no_episode_number`): a `series` library or a season folder, but no number read in the name.

The parser reasons (`classification_ambiguous`, `date_based`, `hint_conflict`, `no_episode_number`) are never sent to TMDB automatically: they wait for the admin. The "To review" list shows the files present on the disk (`ready`); a missing or pending file leaves it until it is back.

In "To review", the admin can: search a TMDB title and assign it (movie, or show + season + episode), declare "it's a movie" / "it's an episode of…", or hide the source. Each correction is saved in `manual_matches` and takes precedence over automatic matching on all later scans.

"It's an episode of…", when the admin keeps the season and episode read from the file name, also identifies with the same show the other files to review of the same series (same show name read from the names) found in the same show folder of the same library root (the folder above the season folder, otherwise the file's folder), each with its own season and episode numbers; those the show lacks stay in "To review" (`episode_not_found`). Numbers typed over the file name's apply to that file alone. All files are checked with TMDB first: nothing is written if one fails; a file hidden, moved or identified in the meantime is left alone. A file without an episode number belongs to no series and is identified alone. The dialog then says how many files were identified and how many stay to review.

These files form the file's **series group**: the files to review (`ready`) of the same series (same show name read from the names, i.e. the same local show), in the same show folder of the same library root, each with an episode number. Any other file to review (movie, `unknown`, episode without a number) is a group of its own. The rule lives in one place on the server and serves the list, "It's an episode of…" and hiding a group alike, so a group shown with N files is the N files an identification of the series takes along. The "To review" list (web and MCP) shows one row per group, in the list's order of files (a group takes the place of the earliest of its files); a group of several files reads "<show> · N files" and unfolds to its files. Identifying a group = "It's an episode of…" on its first file (lowest season, then episode, then path), which carries the others along as above. **Hiding a group** hides every file of the group in one transaction, after a confirmation that gives the number of files; each one then appears in "Hidden" and is shown again on its own.

A `needs_review` file stays visible and playable (under its local item, title taken from the name) until it is corrected.

**Hiding a file** ("To review", "Pending files"): `state = rejected`, the source leaves its items (an item left without a file becomes invisible) and every list; scans never bring it back, full scans included, nor a move (its name is still read again, without ever sending it back to "To review"). "Hidden" lists these files; "Show again" (`POST /admin/sources/:id/restore`, 409 `source/not_rejected` for a source not hidden) reads its name again, puts it back in `pending` and probes it at once, then the matching runs as for a new file (a correction remembered in `manual_matches` applies again, a name to review goes back to "To review"). A hidden file gone from the disk stays in "Hidden"; shown again, the next scan marks it missing.

On a title page, the admin has "Fix the match": same search, same memory. Reassigned sources leave the old item; if it has no source left it becomes invisible, and its per-profile rows (progress, My list, track preferences, markers) move to the new item (episode by episode by number; those of the season and the show when they have no file left). An old item that keeps another file keeps its history.

Correcting a show is atomic: all episodes are first checked with TMDB, then everything is written in one transaction; episodes missing from the new show become `needs_review` (`episode_not_found`) instead of failing the whole thing, and the response lists them (`needsReview`).

---

## 8. Naming conventions table

projo accepts the union of the Jellyfin and Infuse conventions, minus what is out of scope. The app never renames or moves anything. Each row of this table is a parser test case in `apps/server/src/core/naming/naming-table.test.ts`.

### 8.1 Movies

| Case | Accepted | Example |
|---|---|---|
| Flat file | yes | `Movies/Inception (2010).mkv` |
| Folder per movie | yes, the file may have a different name from the folder | `Movies/Inception (2010)/Inception.2010.1080p.BluRay.x264-GRP.mkv` |
| Year | a `19xx` or `20xx` preceded by a delimiter (`space . _ - ( ) [ ]`) and something before it, not followed by digits or a date, not part of a range (`1977-2019`), before the release tags; with several, the last one in parentheses or brackets, otherwise the last one (`Blade Runner 2049 (2017)`, `Blade.Runner.2049.2017`). Everything after it is dropped. A range of years (`2015-2018`, `2015 - 2018`, `2015–2018`, `(2015-2018)`) ends the title too and is dropped, but is never a movie's year and never makes a folder look like a movie folder (`Star Wars 1977-2019/` is a collection); a show takes its first year (§8.2) | `Inception.2010.1080p` → title `Inception`, year 2010 |
| Without year | yes, matching on the title alone with a stricter threshold | `Inception.mkv` |
| Release name cleanup | the title ends at the first release tag. Two lists (`core/naming/title.ts`): **tags**, never title words, always cut (resolutions `1080p` `4k`, codecs `x265` `hevc`, sources `bluray` `web-dl` `hdtv` `hdlight` `4klight` `bdremux` `tvrip` `hdcam`, audio `ac3` `dts` `truehd` `atmos`, platforms `amzn` `nf`… French `vostfr` `vosta` `vff` `vfq` `vfi` `vf2` `truefrench` `multifrench`); **words** that can also be title words (`multi french vf vo fr hd fhd sd web cam proper repack extended unrated limited internal subs`…) cut only when nothing but tags, a year, a range of years, a `[...]` or the end follows them (`The.French.Dispatch.MULTi.1080p` → `The French Dispatch`); episode counts (`(131EP)`, `131 EP`, `131 eps`, `131 épisodes`, `131 episodes`) are such words. Complete-set markers (`Intégrale`, `Intégral`, `Integrale`, `Integral`, `Complete`, `Complète`, `Complet`) are never cut by the parser, since a title can end with one (`Mission Complete (2019)`): ending the title (or the show name), they stay in it, and the parser also gives the title without them (`withoutMarkers`), which the matching tries only when the full title finds nothing (§9.2) (`Les Visiteurs Intégrale/` → `Les Visiteurs Intégrale`, matched as `Les Visiteurs`). Removes a leading `[group]`, and any `[...]` after the title, even before the year (`Avatar [FR-EN] (2009)`); dots and underscores become spaces except in acronyms (`S.W.A.T`) | `[GRP] Le.Fabuleux.Destin.d'Amélie.Poulain.2001.FRENCH.1080p.mkv` → `Le Fabuleux Destin d'Amélie Poulain`, 2001 |
| Id tag | `tmdbid`, `tmdb`, `imdbid`, `imdb`, `tvdbid`, `tvdb`, between `[]`, `()` or `{}`, separator `-` or `=`, on the folder or the file. An IMDb or TVDB id is resolved to a TMDB id through `/find`. A tag skips the search. | `Inception (2010) [tmdbid-27205].mkv`, `Inception {imdb-tt1375666}.mkv` |
| Edition | `{edition-Label}` (Plex, Infuse, Radarr), kept as is (`editionName`), or one of the Infuse labels recognised alone after a separator, stored as an id (`editionIds`, web label `editions.<id>`): `Director's Cut` → `directors_cut`, `Extended Cut`, `Extended Edition` or `Extended Collector's Edition` → `extended`, `Theatrical Cut` → `theatrical`, `Final Cut` → `final_cut`, `Unrated Cut` → `unrated`, `Uncut` → `uncut`, `Special Edition` → `special_edition`, `Ultimate Edition` → `ultimate_edition`, `IMAX` → `imax`, `Remastered` → `remastered` | `Blade Runner (1982) {edition-Final Cut}.mkv`, `Blade Runner (1982) - Director's Cut.mkv` |
| Multiple versions | by TMDB identity: any file matching the same movie is a version, wherever it is | `Dune (2021) - 2160p.mkv` + `Dune (2021) - 1080p.mkv` |
| Parts | `cd`, `dvd`, `part`, `pt`, `disc`, `disk` followed by a number or a letter `a-d`, optional separator, in the same folder | `Movie-cd1.mkv`, `Movie (2010) - part a.mkv` |
| `VIDEO_TS`, `BDMV`, `.iso`, `.disc` stubs, 3D | no: ignored, admin notification `scan/unsupported_layout` once per folder | |

### 8.2 Shows

| Case | Accepted | Example |
|---|---|---|
| Show folder | recommended: `Name (year) [tmdbid-id]`, year and tag optional | `Shows/Breaking Bad (2008) [tmdbid-1396]/` |
| Season folder | `Season 01`, `Season 1`, `S01`, `Saison 1`, `Staffel 1`, `Temporada 1`, `Stagione 1`, `Series 1`, Jellyfin's multilingual keywords, with an optional title after the number; a purely numeric folder `01` (digits only) only below another folder (`24/` at the root is a show) | `Saison 2 - La fuite/` |
| Specials | `Season 00`, `Season 0`, `Specials`. **Not** `Extras` (that is an extras folder, §8.5) | |
| Show name | the folder above the season folder; otherwise what precedes the episode number in the file name, cleaned like a movie title; otherwise (the name starts with the number) the file's folder. A folder carrying an id tag always names the show; the folder's year and id tag complete a name it matches. A range of years gives the show its first year (the year of first air date TMDB searches with, §9.2); complete-set markers ending the name stay in it and give `withoutMarkers`, as for a movie (§8.1) | `Misc/The.Bear.S03E01.1080p.WEB.mkv` → `The Bear`; `Dexter/Season 4/02 - Title.mkv` → `Dexter`; `Dragon Ball Super 2015-2018 Intégral (131EP) TrueFrench 1080p HDLight BluRay AC3 x265-GRP/001 Une récompense pour la paix.mkv` → `Dragon Ball Super`, 2015, season 1, episode 1 |
| Explicit patterns | anywhere, in any library: `S01E02` with optional ` . _ -` separators between S and E, `s1e2`, `S01.E02`, `S01xE02`, `S03 E09`, `1x02`, `se1.ep2`, `season1.episode2`, `Season 1 Episode 2`; `01.02 Title` (season.episode) in a folder. An episode number placed before the pattern changes nothing: the pattern wins | `Dexter.S04E02.Remains.to.Be.Seen.HDTV.mkv` |
| Show context | a `series` library, or a season folder above the file. There, in this order: `Episode 02`, `Ep 02`, `E02`; the first `Name - 12`; a number starting the name (`02 - Title`, `02.Title`, `02`); the last standalone number before the release tags (`Name 64`, `Mob Psycho 100 05`). Never a year (`19xx`/`20xx`), a resolution, a codec number (`x264`, `H.265`), a channel layout (`5.1`) or a number of the folder's title | `Fullmetal Alchemist Brotherhood 64 HD Multi.mkv` → episode 64 |
| Season | the season folder; otherwise the name: `S02E05`, `2x05`, or a season marker right before the episode number (`S2 - 05`, `Saison 2 - 05`, `Season 2 05`, not part of the show name); otherwise 1 | `Shingeki no Kyojin S3 - 05.mkv` → `Shingeki no Kyojin`, season 3, episode 5 |
| Absolute numbering | a number read after the show name (`Name 64`, `Name - 64`) with no season is absolute: assigned if the show has only one season on TMDB, otherwise `needs_review` (`absolute_numbering`); `Episode 02`, `02 - Title` and numbers with a season are episodes of that season. Outside a show context, only `Name - 12` and `Name 101` (3 or 4 digits) in a folder named like the show are absolute (`Naruto/Naruto - 101.mkv`); `Name - 12` elsewhere is `unknown`; any other number belongs to the title (`Fahrenheit.451.mkv`, `OSS.117.mkv` → movies). True absolute mapping: v2 | |
| Episode title | what follows an explicit pattern or a number starting the name (`S04E02.Remains.to.Be.Seen`, `02 - Title`), or what follows ` - ` after a number read after the show name (`Name - 12 - Title`), cleaned like a movie title; nothing else (`Name 64 HD` has none) | |
| No number | an episode of a show context without any number goes to "To review" (`no_episode_number`) | `The Bear/Season 3/The.Bear.Tomorrow.mkv` |
| Multi-episodes | `S01E01-E02`, `S01E01E02`, `S01E01-02`, `1x01-1x02`, `Episode 16-17`; the end number is rejected if followed by digits or `p`/`i` (avoids `S09E14-1080p`) or if lower than the start number | |
| Dated episode | `2017.04.20`, `2017-04-20`, `20.04.2017` detected, `needs_review` (`date_based`). Support: v2 | |
| Safeguard | a season between 200 and 1927 or beyond 2500 is invalid (avoids `1920x1080` read as S1920E1080); an `NxNN` preceded by a channel layout and whose number is a codec (264 to 266) is not an episode | `Furiosa.2024.DDP5.1x265-GRP.mkv` → movie |
| Versions of an episode | by TMDB identity, like movies | `S01E01 - 1080p.mkv` + `S01E01 - 2160p.mkv` |
| Miniseries | season 1 | |

Classification: in a `movies` library, a movie, unless an explicit pattern (episode, `hint_conflict`); in a `series` library, an episode (`no_episode_number` without a number). In `auto`: an explicit pattern or a season folder above = `episode`; absolute numbering in a folder named like the show = `episode`; a dated name = `episode` (`date_based`) in a folder, `unknown` at the root; `Name - 12` elsewhere = `unknown`; otherwise `movie`.

### 8.3 External subtitles

| Case | Accepted |
|---|---|
| Same folder, same base name, dot suffix (Jellyfin) | `Movie.fr.srt`, `Movie.fr.forced.srt`, `Movie.en.sdh.srt`, `Movie.default.fr.ass` |
| Same base name, dash suffix (Infuse) | `Movie-fr.srt`, `Movie-en.forced.srt` |
| Same base name without language | `Movie.srt` → unknown language, label "Subtitles" |
| Language codes | ISO 639-1 (`fr`), 639-2 (`fre`, `fra`), with region (`pt-BR`), plain names `french english français`; `hi` alone = Hindi, `en.hi` = English hearing impaired |
| Flags | `forced` / `foreign`, `sdh` / `cc` / `hi`, `default`; any other text becomes the track title |
| `Subs/` or `subs/` folder | if the parent folder holds a single video, all subtitles of the `Subs` folder are attached to it, language guessed from the name (`2_French.srt`, `English.srt`, `fre.srt`) |
| Formats | `srt ass ssa vtt` (text), `sub`+`idx` (VobSub) and `sup` (PGS), the last two burned in |

### 8.4 Multi-episodes and parts: semantics

- A `S01E01-E02` file is **one** source attached to two episode items (`source_items`). Single playback, progress written on both, "watched" applied to both; the season page shows it as a single "E01-E02" card.
- A movie in parts is one item with N ordered sources; position and duration exposed as cumulative.
- Playback: the session plays the part containing the start position (`parts`, `partOffsetMs` in the response); heartbeats and progress as a cumulative position, duration = sum of the parts; the next part is a new session created by the client. A multi-episode file writes position and "watched" on each of its episodes at every heartbeat.

### 8.5 Extras, ignored in v1

Never imported, never counted as movies or episodes. Folders (case-insensitive, at any level except the root): `Trailers Trailer Behind The Scenes Deleted Scenes Interviews Scenes Featurettes Shorts Extras Extra Other Clips Samples Sample Backdrops Theme-music`. File name suffixes (trailing digits ignored): `-trailer .trailer _trailer - trailer -sample -scene -clip -interview -behindthescenes -deleted -deletedscene -featurette -short -extra -other`. Files `trailer.*`, `sample.*`, `*.sample.*`.

### 8.6 Exclusions

- A `.ignore` (Jellyfin) or `.nomedia` (Infuse) file in a folder excludes the folder and its whole subtree. The content of `.ignore` is not interpreted in v1.
- Ignored everywhere: files and folders starting with `.`, `@eaDir`, `#recycle`, `@Recycle`, `$RECYCLE.BIN`, `System Volume Information`, `lost+found`, `.grab`, `metadata`, `extrafanart`, `extrathumbs`, `.actors`, `*.trickplay`, `Thumbs.db`, `.DS_Store`.
- Forbidden characters in names (out of scope, but the parser must not crash): `< > : " / \ | ? *`.

---

## 9. Metadata

### 9.1 TMDB

- Single source. No key ships with projo: an admin pastes one (API key or read access token) in Admin → Metadata (`settings.tmdb_api_key`), checked against TMDB. Without a key, files are not identified (titles from the file names, no images) and the `metadata/tmdb_key_missing` notification and the admin banner say so.
- Metadata language at server level (`settings.metadata_language`, default `fr-FR`), overridable per library, field-by-field `en-US` fallback if the overview or the title is missing (a generic episode name, `Épisode 7`, counts as missing; still generic after the fallback, the episode has no title of its own, §6.3). Images requested with `include_image_language=<lang>,en,null`. Rating (`content_rating`) read from `release_dates` (movies) and `content_ratings` (shows) for the library's `rating_country`, US fallback; its country is stored with it (`content_rating_country`) and the profiles' maximum rating filter compares it on **that** country's scale (a fallback `PG-13` in a French library is judged on the US scale, a title present in two libraries of different countries keeps a single rating). Seasons and episodes inherit from the show. The API sends the official code as is, with its country and the §14 age tier it falls in (`contentRating: { code, country, tier }` of `packages/shared/api/content-ratings.ts`; tier = the lowest profile ceiling that lets it through, `R` → 18, absent outside the scale like `NR`); the badge shown is composed by the web (§13.5).
- **Item in several libraries**: the language and rating country of a movie or a show, seasons and episodes included, are those of the **oldest library** (`created_at`, then `id`) that contains a file of the movie or show (episodes included), whatever the library of the file being identified (`infrastructure/sqlite/item-library.ts`). A file identified in another library first writes with its own library's settings; if they are not those of the deciding library, the movie or show is refreshed (§9.4). Same rule at each write and at each change of the deciding library (file from an older library, library or root deletion, purge of missing files, correction or rejection of a file): a tree with mixed settings is refreshed entirely (§9.4).
- **Genres**: a fixed list of projo ids (`genreIds` of `packages/shared/api/genres.ts`: `action`, `adventure`, `animation`, `comedy`, `crime`, `documentary`, `drama`, `family`, `fantasy`, `history`, `horror`, `kids`, `music`, `mystery`, `news`, `politics`, `reality`, `romance`, `science_fiction`, `soap`, `talk`, `thriller`, `tv_movie`, `war`, `western`), the only thing stored. TMDB genre ids are converted to them (`core/metadata/genres.ts`); combined show genres are split: `10759` Action & Adventure → `action` + `adventure`, `10765` Sci-Fi & Fantasy → `science_fiction` + `fantasy`, `10768` War & Politics → `war` + `politics`. TMDB order, without duplicates; an unknown TMDB id is ignored and logged. The displayed name comes from the web locales (`genres.<id>`), in the interface language: a TMDB genre name is never stored. Seasons and episodes receive their show's genres.
- Dedicated HTTP client in `infrastructure/tmdb/`: concurrency 4, honours `Retry-After` on 429, 10 min in-memory cache of search responses, 10 s timeouts, every response validated by Zod.
- Images downloaded during enrichment, never hotlinked: posters `w500`, backdrops `w1280`, logos `w500` (PNG kept), episode stills `w300`, cast photos `w185`. Stored in `/data/images/<kind>/<id>.<ext>`, served by `/api/v1/images/<id>` with `Cache-Control: immutable` (the id changes if the image changes).
- WebP variants (quality 82, metadata dropped, transparency kept) encoded by ffmpeg as soon as an image is stored (TMDB, chosen or uploaded): one per width of the ladder 185 / 342 / 500 / 780 / 1280 under the image's own width (`<id>.w342.webp`), plus the full size (`<id>.full.webp`), deleted with it. `/api/v1/images/<id>?w=<width of the ladder>` serves that variant (wider than the image: the full size), without `w` the full size; the clients list the ladder in `srcset` and the browser picks by display width and density. While the variants are missing (encoding failed, image older than them) the original is served, cached one hour only. "Optimize images" (Admin → Server → Maintenance, `POST /admin/images/optimize`) queues the `image_variants` job, which writes the missing ones: the images stored before the variants existed, or after an encoding failure.
- Cast: first 20 actors + directors + writers, displayed, not clickable.

### 9.2 Matching

First of all: if a `manual_matches` row exists for the file (its source, then library + relative path, then signature), it applies, even if the original source was purged in the meantime.

**Movie**:
1. Id tag present → `/movie/{id}` (or `/find` for IMDb/TVDB). Done.
2. `/search/movie?query=<title>&year=<year>&language=<lang>`; as long as no candidate is acceptable or ambiguous (step 4), retry without the year, then with the title before the first `-` or `:`. Candidates from all searches are ranked together (`BAC Nord (2020)`: the search with 2020 only returns unrelated titles, the movie is from 2021). Title ending with complete-set markers (§8.1, `withoutMarkers`): only when all of that, alternative titles included (step 4), ends in `no_match`, the same searches run again with the title without the markers, and their candidates are scored against that shorter title, under the same threshold and margin; an `ambiguous_match` of the full title stops there. The full title thus always wins when TMDB knows it (`Mission Complete (2019)` is never matched as `Mission`).
3. Score per candidate: similarity of the normalised title (lower case, no accents, no punctuation) with `title` and `original_title` (max of the two), bonus for the exact year, penalty for year ±1, penalty for a different year, popularity bonus as a tie-breaker.
4. Accepted if the best score is above the threshold **and** beats the second by a margin; otherwise `needs_review` (`ambiguous_match` or `no_match`). Without a year in the name, the threshold is higher.
   - No title close enough: the alternative titles (`/alternative_titles`, all countries) of the 3 best candidates enter the max of step 3, then the choice is made again (`Star Wars Episode VI Return of the Jedi` is an alternative title of `Return of the Jedi`).
   - Candidates too close for the margin: the one with the best similarity and at least 10 times more TMDB votes (`vote_count`, at least 50) than each of the others is accepted (`What If...?`, 4,755 votes, against `WHAT / IF`, 187).
   - Year off by one: a candidate with the exact title at ±1 year, with at least 10 times more votes (and at least 50) than each exact-title candidate of the exact year, wins over them (`Split (2016)`: the 2017 movie, 18,767 votes, against three 2016 `Split`s with fewer than 60 votes).

**Episode**:
1. Resolve the show: id tag on the show folder or the file, otherwise `/search/tv?query=<show>&first_air_date_year=<year if present>`, same scoring and same retries, the name without its complete-set markers included (as for a movie, step 2). The show result is cached by normalised name for the whole scan.
2. `/tv/{id}` then `/tv/{id}/season/{n}` (cached in the database, refreshed per §9.4); episode `n` must exist, otherwise `needs_review` (`episode_not_found`).
3. Creating or attaching the show → season → episode items. Seasons and episodes **without a file are not created**; `episode_count_tmdb` lets the UI show "12 / 22 episodes".

External ids (`/external_ids`) fetched for every movie and show: needed by the segment providers.

### 9.3 Editing and locking

In the admin, on a movie, a show, a season or an episode: title, year, overview, genres (picked from the fixed list of §9.1), poster, backdrop. Images are picked from the TMDB alternatives (`/images`) or uploaded (JPEG/PNG/WebP, 10 MB max, stored in `images/custom/`). Each edited field creates an `item_overrides` row: it is locked and a refresh no longer overwrites it. A "Back to the TMDB value" button per field deletes the row. Edits are on the item: a rescan, a rename or a move does not touch them. Age rating, cast, score and runtime are not editable.

### 9.4 Refresh

| What | When |
|---|---|
| Metadata of an episode | when its file appears |
| Show with `series_status = in_production` | weekly `refresh_metadata` job (seasons, episodes, missing images) |
| Any item | "Refresh" button on the title page (admin) |
| A whole library | admin button, low-priority job, 1 item at a time, locks honoured |
| Language or country changed | change of the server language, of a library's language or its `rating_country`, or of the deciding library (§9.1): the movies and shows concerned, low-priority `refresh_metadata` (10) |

A refresh never creates an episode without a file and never deletes an item.

**Language or country change**: automatic, without confirmation. Each TMDB write records its language (`items.metadata_language`). Server language changed: every movie or show with an identified item not in the language it now resolves to (§9.1); a library's language: the same, limited to the movies and shows with a file in that library; a library's `rating_country`: the movies and shows it is the deciding library of (the requested country is not stored, only that of the chosen rating is). Deciding library changed: after an identification, the tree is stale if an identified item is not in the resolved language or if its `content_rating_country` differs from that of the movie or show just written (seasons and episodes inherit from the show: same chosen country, same rating); when files leave (library or root deletion, purge of missing files, correction or rejection of a file), the movies and shows that had some are noted beforehand, then refreshed if their tree is stale or if the `rating_country` of their new deciding library differs from the old one. A tree left without files is not refreshed. One `refresh_metadata` job per movie or show, priority 10, deduplicated per item (`refresh:<id>`), concurrency 1 and a TMDB client at 4 requests: the cost is that of "Refresh the whole library", without touching items already up to date; until then, the profiles' filter stays correct thanks to `content_rating_country`.

---

## 10. Playback and streaming

### 10.1 Starting constraints

A browser does not play the MKV container, nor AC3/EAC3/DTS/TrueHD audio (Safari plays AC3/EAC3), nor HEVC without hardware decoding, nor bitmap subtitles. Most of a household's files are MKVs. The server must therefore always be able to remux and transcode audio, and to transcode video when needed. The desktop app (§28) is the exception: libmpv reads every container, codec and subtitle format the library holds, so at original quality it plays the file itself.

### 10.2 Choosing the playback mode

At every playback start, the client sends its **capabilities**: the result of `MediaSource.isTypeSupported` and `navigator.mediaCapabilities.decodingInfo` for a fixed list of codecs (`avc1`, `hvc1`/`hev1`, `av01`, `vp09`, `mp4a.40.2`, `ec-3`, `ac-3`, `opus`, `flac`), plus the screen height, how it shows text subtitles: `subtitleDelivery = overlay` (default, the web: WebVTT `<track>`), `hls` (the iOS app, and the web in Safari on iPhone and iPad with native HLS, §10.4) or `engine` (the player engine draws every subtitle itself, §10.4), and the engine that plays: `engine = browser` (default when absent: `<video>`, AVPlayer) or `mpv` (the desktop app, §28), and whether it renders HDR video: `hdrVideo` (the web: `matchMedia('(video-dynamic-range: high)')`; absent = unknown, which changes nothing). The iOS app declares `hls: native` and the codecs AVFoundation decodes on the device. The desktop app declares `engine: mpv`, `hls: native`, every codec of both lists, the screen height and `subtitleDelivery: engine`. For a `browser` engine the server chooses:

| Condition | Mode |
|---|---|
| `mp4`/`m4v`/`mov`/`webm` container **and** supported video codec **and** supported audio codec for the chosen track **and** no burn-in | `direct`: the file is served over progressive HTTP with `Range`, the browser plays it natively |
| Supported video codec, but unplayable container or unsupported audio | `hls_remux`: video copied (`-c:v copy`), audio copied if it is AAC, or AC-3 or E-AC-3 supported by the client, otherwise transcoded to stereo AAC 192 kb/s (Opus and FLAC are always transcoded: unreliable in HLS fMP4 on Safari) |
| Unsupported video codec, or lower quality requested, or subtitle burn-in | `hls_transcode`: video as H.264 (`libx264`, preset `veryfast`, or `ultrafast` on a server too slow for it (§10.3), CRF 21 for "Original", target bitrates per quality), audio as AAC |

Qualities offered in the player: Original, 1080p (8 Mb/s), 720p (4 Mb/s), 480p (1.5 Mb/s). "Original" in transcode mode keeps the source resolution. Multichannel audio is downmixed to stereo by default (`settings.audio_downmix = stereo | keep`).

Changing the audio track, burned-in subtitles, quality or version starts a new playback session at the current position (except an audio change made in place by the `mpv` engine, below).

**Decode fallback.** Capabilities say what a client should decode, not what it will: Safari on an iPad announces `hvc1` and `ec-3`, gets a 4K HEVC Main 10 Dolby Vision file as `hls_remux` at Original, and cannot play it. When a session whose video is not transcoded (`direct` or `hls_remux`) fails because the engine cannot decode or does not support the stream, the player opens a new session of the same source at the best quality below Original in `availableQualities` (1080p, else 720p, else 480p), which is always `hls_transcode`: a lower quality transcodes even when it equals the source height (1080p for a 1080p file). Nothing changes on the server: it is a quality change made by the player (tracks kept, §10.7). At most once per source of the item being played; a session already `hls_transcode`, a source without a quality below Original, or a second decoding failure of that source shows the blocking error as before. Network failures never fall back. The `mpv` engine never reports a decoding failure (it plays Original itself), so this never applies to it. A stream an engine refuses without an error counts as a decoding failure too: the startup watch of §10.7.

**HDR video on a client that does not render it.** Safari on an iPhone (and likely an iPad) can answer `dynamic-range: high` but not `video-dynamic-range: high` (not in Low Power Mode; why is not known). In that state, given a master playlist whose variant declares `VIDEO-RANGE=PQ` (a copied HDR or Dolby Vision video), it loads the master and then requests nothing, without a `MediaError`; declared SDR (no `VIDEO-RANGE`), the variant fails after its init and first segment, whatever its `RESOLUTION`, `BANDWIDTH`, `CODECS`/`SUPPLEMENTAL-CODECS` or audio. Given the media playlist `index.m3u8` itself, with no master, it plays the very same init and segments (E-AC-3 Atmos copied, Dolby Vision RPU still in-band), tone mapped by iOS. Transcoding instead is not an option for such files on a small server (tone mapping a 4K HDR source to 1080p SDR on a Celeron J3455 is far below real time). So an `hls_remux` session whose copied video is `hdr` or `dv` (§7.7), for a client with `hls: native` that sent `hdrVideo: false` and asked for `subtitleDelivery = hls`, is served without a master playlist: its stream URL is `index.m3u8` and its text subtitles are sidecar `<track>`s (`subtitleDelivery: 'track'` of the session, §10.4). The rule is `sessionSubtitleDelivery` of `core/playback/subtitle-delivery.ts`; a client asking for `overlay` already gets the media playlist.

**Engine `mpv`** (`clientCapabilitiesSchema.engine`, `@projo/shared/api/playback`): libmpv plays any container (MKV, MP4, AVI, TS, M2TS…), any video codec (H.264 including 10-bit, HEVC, AV1, VP9, VC-1, MPEG-2; HDR10, HLG, Dolby Vision) and any audio codec (AAC, AC-3, E-AC-3, DTS and DTS-HD, TrueHD, FLAC, Opus…), and draws every subtitle format. For such a client:
- Quality `original` ⇒ always `direct`, whatever the container, the codecs, the chosen audio track and the chosen subtitle track (bitmap included). The `hev1` rule above does not apply. `stream.mimeType` comes from the file's extension (`fileMimeType` of `core/playback/decide-mode.ts`: the `direct` containers above, then `mkv` → `video/x-matroska`, `avi` → `video/x-msvideo`, `ts`/`m2ts`/`mts` → `video/mp2t`, `mpg` → `video/mpeg`…), `application/octet-stream` otherwise; the `direct` route serves any container with `Range`, under the session's capability URL (§20, libmpv sends no cookie).
- A lower quality ⇒ `hls_transcode` as today (libmpv plays HLS through its own demuxer: the media playlist `index.m3u8`, no `master.m3u8`).
- Never burn-in: `burnIn` is always `false` and a bitmap track never forces `hls_transcode` (§10.4 for what the engine draws in each mode). `settings.burn_in_enabled` does not apply to such a client.
- A `direct` session takes no transcode slot (§10.3): neither `max_concurrent_transcodes` nor `0` keeps it from playing; `playback/transcode_limit_reached` only concerns its lower qualities.
- Audio change in a `direct` session: the engine switches in place (mpv `aid` set to the track whose `ff-index` is the `audioTracks[].index` of the session, the absolute stream index of the probe) and the client only reports the manual change (§11.3): no new session, no new stream. In an `hls_transcode` session, which carries a single audio track, it starts a new session as for the browser.

A quality above the source is brought down to the best offered one (never upscaling); `availableQualities` = Original + the qualities ≤ the source height (16:9 equivalent height: a 1920×800 is 1080p). Without HLS on the client, a file that must be transcoded gives `playback/mode_unsupported` (`playback/transcode_unavailable` no longer exists). An HEVC tagged `hev1` (probe: `codec_tag_string`) does not go `direct`: Safari only plays `hvc1`, `hls_remux` retags it.

### 10.3 HLS pipeline

- An HLS session = a `/data/cache/transcode/<session_id>/` folder, an `index.m3u8` playlist, fMP4 segments (`init.mp4`, `seg-00042.m4s`), one ffmpeg process at a time.
- Segments of about 2 s in transcode mode, each one fragment opened by a forced IDR (no other keyframe), which allows a complete playlist computed in advance from the video stream duration (the container's if the probe does not have it: an audio track longer than the video would leave a last segment without picture, never produced). With a fresh keyframe index of the source (below), every source keyframe at least 1 s after the previous cut and 1 s before the end starts a segment and a longer GOP is split in equal pieces of 2.5 s at most (`planTranscodeSegments`, `-force_key_frames` with the list of cuts); without one, a fixed 2 s grid (`expr:gte(t,n_forced*2)`), the index being queued in the background for the next sessions (the playlist of a session never changes).
- A transcode run that starts on a segment opened by a source keyframe decodes nothing before it: the video input is opened at the keyframe (`-noaccurate_seek -ss <t+2 ms>`, timestamps rebased on the keyframe itself), the audio from a second opening of the file 0.5 s earlier (`aselect` from −0.5 s), so the runs still overlap without an audio hole. Any other start (a piece inside a GOP, burn-in, the fixed grid) decodes from the previous keyframe and trims to the segment start as before. The session gives the web player these fast seek points (`seekPointsMs`, the keyframe cuts of the current source, only for `hls_transcode` without burn-in and with a fresh index): a click or a drag on the playback bar lands on the nearest one within 4 s; the ±10 s buttons, shortcuts, chapters and segment skips stay exact.
- Software transcode speed: each software run measures its encoding speed over 12 s of content produced without being held back by the buffer window. Below 1.25× real time with `veryfast`, sources of the same kind (codec, pixel format, height, quality, HDR, burn-in) start with `ultrafast` from the next session on; above 3× with `ultrafast`, back to `veryfast`. Remembered in `cache/transcode/x264-presets.json` (survives restarts, logged `playback/x264_preset`). A session keeps the preset of its first run: its segments share one init (SPS/PPS).
- In remux mode, cuts can only fall on the source's keyframes: a **keyframe index** (timestamps) is extracted once per source (cache `/data/cache/keyframes/<source>.json`): from an MKV's `Cues` when they list all keyframes of the single video track (checked block by block on three cluster stretches, at a quarter, half and three quarters; a few tens of MB read at most instead of the whole file, decisive on a network share), otherwise with `ffprobe -select_streams v:0 -show_entries packet=pts_time,flags`, which reads the whole file. It runs at first playback if it does not exist yet (interactive job, high priority) and as a background job after enrichment. The playlist is computed from this index (segments of 3 to 8 s, bounded by keyframes).
- The playlist is served complete from the start (`#EXT-X-PLAYLIST-TYPE:VOD`), which gives a complete playback bar and immediate seeking. A request for a segment not yet produced and outside the current production window (current segment + 3) kills ffmpeg and restarts it at the requested segment's keyframe (`-ss <t> -copyts -start_number <n>`).
- A requested segment not yet written is awaited up to 20 s before 503, only if it is coming in the current run; a segment already passed (deleted behind the player) restarts ffmpeg. Only the latest segment request can restart ffmpeg, a request abandoned by the client stops, and a run that finished without producing the requested segment gives an error (no restart).
- End of session (explicit stop, or 60 s without heartbeat): ffmpeg killed, folder deleted after a 5 min grace period. The `cleanup_cache` job caps `cache/transcode` at `settings.transcode_cache_max_gb` (default 10) by deleting the oldest finished sessions.
- Maximum number of simultaneous transcodes: `settings.max_concurrent_transcodes` (default 2, configurable without a ceiling). Remuxing and direct play (the desktop app's included, §10.2) do not count; a live channel's `compat` stream takes one (§29.4), which it gives up as soon as another transcode needs it while it has no viewer (in its idle delay): such idle streams are stopped first, the one idle the longest first. Beyond it: error `playback/transcode_limit_reached`, the player shows "Too many playbacks running on the server". Also not counted: sessions without heartbeat for 60 s, and the most recent one of the same authentication session on the same item (the player replacing its session, whether it stops the old one before or after); only one is exempted, other tabs of the same browser on the same title count. `0` disables transcoding.
- HDR to SDR: a source whose video is HDR or Dolby Vision (`dynamicRange` of §7.7, from the probe: transfer `smpte2084` or `arib-std-b67`, or Dolby Vision side data or tag) comes out of `hls_transcode` as SDR BT.709. The picture is scaled to the quality first, then tone mapped on the CPU (`zscale` linearization, `tonemap=hable:desat=0`, back to BT.709, tagged BT.709), then the burned-in subtitles are drawn over it. Only if the ffmpeg binary has `zscale` (libzimg) and `tonemap`, as the image's does; otherwise the picture is only converted to 8 bits and comes out washed out. Tone mapping is the costliest part of a transcode, worst at Original on a 4K source: each run logs `playback/hdr_tonemap`. `direct` and `hls_remux` pass HDR through unchanged. Dolby Vision profile 5 (no HDR10 base layer) comes out with wrong colours.
- Hardware transcoding: `settings.hw_accel = off | vaapi` (default `off`, §15 "Playback"). With `vaapi`, a transcode without burn-in is decoded, scaled (`scale_vaapi`) and encoded (`h264_vaapi`, QP 21 at Original, otherwise the quality's bitrate, the same forced IDRs on the segment cuts) on the render node `/dev/dri/renderD128`: an Intel iGPU through the image's iHD driver, the container given the device and its group (README). A source the GPU cannot decode (H.264 10-bit, which no iGPU decodes; a codec or profile its driver lacks) is decoded on the CPU, then converted to NV12 (P010 for HDR) and uploaded (`format=nv12|vaapi,hwupload`, a no-op on frames already on the GPU) to be scaled and encoded on the GPU all the same. HDR: scaled on the GPU keeping 10 bits, downloaded, tone mapped on the CPU as above (on the scaled frame), uploaded back to the encoder; never `tonemap_vaapi` (Gen9 iGPUs have none: one rule for every GPU). Burn-in: software. ffmpeg falls back to CPU decoding by itself for some decoders only: with `-hwaccel`, AV1 goes to ffmpeg's native `av1` decoder, which has no software path ("Your platform doesn't support hardware accelerated AV1 decoding" on a GPU without AV1 decoding, Intel before Gen12). So the fallback goes one step at a time, decided per session: a render node missing or not readable and writable by the process makes the session's first run software; a VAAPI run that fails before the session has an `init.mp4` is retried at once one step down, from decoding on the GPU to decoding on the CPU (no `-hwaccel`, the device kept for the upload, scaling and encoding), then from there to software. The CPU-decoding step logs `playback/hw_decode_unsupported` (info) and raises nothing; once such a run writes its init, the source's codec and pixel format are remembered (in memory, until the server restarts) and later sessions of that kind start decoding on the CPU. A render node missing or a CPU-decoding run that fails too (device, driver) log `playback/hw_accel_failed` (warning) and raise the notification of the same name, resolved by the next VAAPI run that writes its init. A failure once the init exists is an ordinary stream failure: a session never changes encoder.
- On Safari (iOS, macOS), HLS is played natively; elsewhere through hls.js.

### 10.4 Subtitles

| Type | Handling |
|---|---|
| External text (`srt`, `ass`, `ssa`, `vtt`) | converted to WebVTT by ffmpeg on first request, cache `/data/cache/subtitles/<source>/<n>.vtt`, served as a `<track>` of the player, whatever the mode. ASS styling is lost (v2: libass). |
| Embedded text (`subrip`, `ass`, `webvtt`, `mov_text`) | extracted by ffmpeg (`-map 0:s:<n>`) as WebVTT, same cache, same `<track>` |
| Bitmap (`hdmv_pgs_subtitle`, `dvd_subtitle`, external `sup`, `sub`/`idx`) | **burn-in**: `hls_transcode` mode forced with an `overlay`/`subtitles` filter; the player shows "Burned-in subtitles, reduced quality". Can be turned off: `settings.burn_in_enabled` (default true); if off, these tracks are listed greyed out as "not supported". A bitmap track picked by the cascade (§11.2, not explicitly requested) that cannot be burned in (transcode limit reached, client without HLS) is left aside: the session starts without subtitles rather than failing. Never for `subtitleDelivery = engine` (below). |

Subtitle delay and size: adjustable in the player, remembered per device.

**Delivery inside HLS** (`subtitleDelivery = hls`: the iOS app, §26.6, and the web in Safari on iPhone and iPad): AVPlayer only shows subtitles the stream declares, never a separate file. For such a client:
- A session whose resolved subtitle (§11.2) is a text track is at least `hls_remux`, never `direct`.
- An HLS session is served through a master playlist (`master.m3u8`) that references the video playlist and declares every text track of the source as a WebVTT rendition (`#EXT-X-MEDIA:TYPE=SUBTITLES`, language, name, `FORCED`, `CHARACTERISTICS` for SDH), the resolved one `DEFAULT=YES`. Each rendition is a playlist of a single segment over the same WebVTT file as the `<track>` (same cache), aligned with the video timeline: the file served there starts with `X-TIMESTAMP-MAP=MPEGTS:900000,LOCAL:00:00:00.000`, the 10 s output offset of the HLS segments (`outputTimestampOffsetS`, `core/playback/hls-playlist.ts`, the two stay tied: `MPEGTS:0` puts the cues 10 s off). Every URL of the master and media playlists is relative, under the session's capability URL (§20), so AVPlayer's sub-requests and AirPlay receivers load them without credentials. They follow the video into Picture-in-Picture and AirPlay. iOS ignores `DEFAULT=YES` unless its own captioning setting asks for subtitles: the client selects the resolved rendition itself. The rendition `NAME` is the track title, else its language, made unique in the group (`subtitleRenditionNames` of `@projo/shared/api/playback`, used by both sides). `BANDWIDTH` is the source's average bitrate (size over duration); `CODECS` is left out.
- Delay: `master.m3u8?subtitleOffsetMs=` (±10 s) is carried to every rendition and moves its `X-TIMESTAMP-MAP` anchor (positive: later); changing the delay reloads the playlist at the current position in the same session (no new ffmpeg). Size and style: the iOS accessibility settings, not the app.
- The web in Safari on iPhone and iPad: no `<track>` nor drawn cues; the subtitle menu shows the `video.textTracks` entry whose label is the rendition `NAME`; picking a track from a `direct` session starts a new session; the size setting is hidden.
- A track picked in the app's player is a manual change (§11.3), reported by the client.
- Bitmap tracks: unchanged (burn-in).
- Exception: a session that cannot be given a master playlist (a copied HDR video for a client without HDR video, §10.2) gets the sidecar delivery below instead.

**Sidecar delivery** (`subtitleDelivery: 'track'` of the session, never asked for by a client: decided by the server for the exception above, the web in Safari on iPhone and iPad). The session DTO always carries the delivery the server chose (`subtitleDelivery`: `overlay`, `hls`, `engine` or `track`; a client talking to an older server, which leaves it out, goes by the one it asked for); the stream URL names `master.m3u8` only for `hls` (`streamPlaylistOf`). In a `track` session:
- The stream is the media playlist `index.m3u8`; no master, no rendition.
- Every text track is `delivery: 'vtt'` with `url` = its plain WebVTT under the session's capability prefix (`/stream/:sessionId/:secret/tracks/:trackId.vtt`, §20): the same conversion and cache as the `<track>` of the overlay, with no `X-TIMESTAMP-MAP`. Cues stay on the source timeline, which is the `<video>`'s `currentTime`: Safari's `currentTime` over a VOD media playlist follows the playlist from 0, whatever the 10 s output offset of the segments' timestamps (`outputTimestampOffsetS`, §10.3), the same assumption the overlay makes over native HLS in Safari on a Mac; a session plays one part (§8.4), whose timeline is its source's, so `partOffsetMs` needs no compensation.
- The engine (`html-video`) attaches one `<track kind="subtitles">` per such track to the `<video>` (label = the rendition name of `subtitleRenditionNames`, `srclang` = its language), the resolved one `default` and `showing`, the others `disabled`; Safari draws the cues itself, inline, in its native full screen and in Picture-in-Picture; projo's overlay draws nothing. A change of track switches which one is showing, in place (no new session, no reload), reported as a manual change (§11.3); the selection is applied again once the media's metadata is there, over Safari's own automatic choice. The tracks are removed when the stream is detached.
- Delay: the engine moves the cues of every loaded track (as the overlay does), at once, without reloading anything; `subtitleOffsetMs` is not used. Size and style: the system's caption settings; the size setting is hidden.
- Bitmap tracks: unchanged (burn-in when enabled, which transcodes: the session is then `hls_transcode` with its master playlist, or "not supported").

**Delivery by the engine** (`subtitleDelivery = engine`: the desktop app, §28, whose libmpv draws text and bitmap subtitles itself): no `<track>`, no master playlist, no rendition, never burn-in. `subtitleTrackDtoSchema` gains `delivery: 'engine'` and `streamIndex` (the absolute stream index of the probe, `source_subtitles.stream_index`, which is mpv's `ff-index`, set on embedded tracks only). Per mode:
- `direct` session: an embedded track, text or bitmap, is `delivery: 'engine'` with its `streamIndex` and no `url`; the engine selects it in the file (mpv `sid` set to the track whose `ff-index` is `streamIndex`), with its full styling (ASS, PGS), except the font: text is drawn in Geist SemiBold like the web's captions, ASS included (mpv `sub-font`, and `sub-ass-style-overrides=Fontname=…` for every ASS style; sizes, colours, positions and the inline `\fn` of typeset signs stay the file's). An external text track is `delivery: 'vtt'` with `url` = its WebVTT under the session's capability prefix (`/stream/:sessionId/:secret/subtitles/:trackId.vtt`, §20: libmpv sends no cookie), the same conversion and cache as the `<track>`; the engine loads it (mpv `sub-add <url> select`). An external bitmap track (`sup`, `sub`/`idx`) is `delivery: 'unsupported'` (no route serves the raw file).
- `hls_transcode` session (a lower quality): the HLS output carries no subtitle stream, so every text track, embedded or external, is `delivery: 'vtt'` with its capability WebVTT `url`, loaded by the engine as above; every bitmap track is `delivery: 'unsupported'`, and one picked by the cascade or named by the request is left aside (the session starts without subtitles, no error).
- Cues stay on the source timeline: libmpv shows an external track on its own playback position, which starts at 0 for an HLS session too (mpv `rebase-start-time`, its default), so the 10 s output offset of §10.3 needs no compensation.
- The engine applies the session's resolved tracks (§11.2) when the file is loaded (`aid`, `sid` or `sub-add`, `sid=no` for none), never libmpv's own choice. A change of subtitle track is always made in place (no new session) and reported as a manual change (§11.3).
- Delay and size: in the engine (mpv `sub-delay`, `sub-scale`), remembered per device as above; `subtitleOffsetMs` is not used.

Cache: `<track>.vtt` (`source_subtitles` id) next to `<track>.json` (size and mtime of the converted file: the external one, or the video for an embedded one); converted again when it changes, concurrent conversions of a track shared. An external file not in UTF-8 (BOM, otherwise invalid UTF-8 ⇒ Windows-1252, a superset of Latin-1) is re-encoded to UTF-8 before ffmpeg. Access: the active profile (last profile of the auth session for `<track>`) sees the source (same rule as `listReadySources`), otherwise 404 `playback/subtitle_not_found`; bitmap ⇒ 422 `playback/subtitle_unsupported`. `pre_extract_subtitles`: `extract_subtitles` job (priority 15) on `source.ready`, all embedded text tracks in one ffmpeg pass.

### 10.5 Timeline thumbnails (trickplay)

`trickplay` job per source, low priority, after enrichment, one heavy ffmpeg job at a time (§18), if `trickplay_enabled` on the library: `ffmpeg -vf fps=1/10,scale=320:-2,tile=10x10` → JPEG sprites + JSON index (`{interval, width, height, columns, sheets[]}`) in `/data/cache/trickplay/<source>/`. The player shows them when hovering the bar if they exist, otherwise nothing. Can be turned off (`settings.trickplay_enabled`). Deleted with the source.

Implementation: queued on `source.ready` (priority 10: runs after matching and images); decoding keyframes only (`-skip_frame nokey`: thumbnail `i` is the last keyframe at or before `i × 10` s, a few seconds early with a long GOP), the last one held up to the probed duration (`tpad`, `trim`), `fps=1/10:round=up` (one thumbnail per started 10 s, so a file shorter than 10 s gets one); the index's `times` give the source instant of each thumbnail (the pts of its keyframe, read from `showinfo`), and the player previews the thumbnail whose instant is nearest the point a click lands on (after the seek-point snap of §10.3), which its preview time shows too; sprites without `times` are still served (nearest multiple of 10 s) and rebuilt by the backfill; `source.json` (the source's size and mtime in the database) invalidates the sprites of a replaced file; the session's `trickplayUrl` is only set for up-to-date sprites; ready sources without up-to-date sprites are queued 2 min after startup then every day (`trickplay-backfill` task), those of an item a profile is watching at priority 12 (the resume frame of "Continue watching"). Routes: same access control as subtitles, 404 `playback/trickplay_not_found`. `trickplay` and `preview_clip` jobs wait (`isRunnable`) while an `hls_transcode` runs on a server with fewer than 4 cores (§18).

### 10.6 Playback sessions and progress

- `POST /playback/sessions` with item, optional source, capabilities, wanted tracks, quality → mode, stream URL, resolved tracks, known segments, resume position.
- Heartbeat every 10 s and on every pause, seek, track change and close (`navigator.sendBeacon`): current position. The server writes `playback_progress`.
- End: `DELETE`. Without heartbeat for 60 s the session is considered ended.
- The admin sees active sessions (profile, item, mode, quality, position, device) and can stop one: the player receives `playback/session_terminated` over SSE and shows "Playback stopped by the administrator". `/admin/sessions` page (profile, title and "S2 · E4", mode, quality, burn-in, version, position, device, "Stop"), refreshed every 5 s; a session without heartbeat for 60 s no longer appears; `DELETE` of an already ended session ⇒ 404.

### 10.7 Player

Home-made, no Video.js, in three parts (layers in §5.3): `@projo/player`, the playback logic; engines, which play; the interface, which shows. Matches the `Player` and `PlayerNext` artboards: full-frame video, top (exit) and bottom chrome fading out after 3 s without movement, playback bar with visible segment zones, buffer, trickplay on hover and remaining time, then the row of controls: play/pause, −10 s, +10 s, volume, title and "S2 · E4 “Title”" in the middle, next episode, episode list, chapters (when the file has some), subtitles and audio, settings, Picture-in-Picture (where supported, not on phones), full screen. Each of chapters, settings (speed: a slider with four steps, 0.5×, 1×, 1.5× and 2×, resisting between them, its value beside the section title; then version and quality when there is a choice of quality or version; then the playback info switch) and subtitles and audio (audio and subtitle tracks, subtitle size and delay) opens its own small, nearly opaque menu, sized to its content. A chapter with the muxer's default name (`Chapter 01`, `Chapitre 3`, `07`) arrives without a title (filtered at the API output, the stored `probe` is intact): the player shows "Chapter 3" from its position, in the menu as in the bar preview. "Skip intro" at the bottom right with its 8 s bar, "Intro skipped · Undo" toast at the bottom left. In the credits, the "Next episode in N s" bubble takes the place of "Skip intro" at the bottom right, glass with a countdown ring and a close button ("Watch the credits"), without hiding the video nor the controls; subtitles move above it (§12.4). At the end of the file, the "Next episode" screen shrinks the video to a thumbnail, shows the next episode (number, runtime, title, overview, cast, direction, writing, music) and the "Next episode" button (with countdown).

System integration: Now Playing through the host's system media (`AppHost.systemMedia`, §5.2: the Media Session API in the browser, Windows' system media controls in the desktop app, §28.7) (title, series, poster; play/pause, ±10 s, seek, next episode on the lock screen, in Control Center and from headset keys); an AirPlay button next to Picture-in-Picture when Safari reports a receiver (`webkitShowPlaybackTargetPicker`, streams under the capability URLs of §20); full screen locks landscape where the browser allows it (Android).

Shortcuts: `space` play/pause, `←`/`→` ±10 s, `↑`/`↓` volume, `M` mute, `F` full screen, `S` skip the current segment, `N` next episode, `C` subtitles on/off, `I` playback info, `<`/`>` slower/faster (the speed steps), `Esc` back (below); `Backspace` and the back keys (`BrowserBack`, `GoBack`, never left to the browser) act as `Esc`. A gamepad (§19): its d-pad and left stick, A, and B or View act as the arrows, `Enter` and a back key; X and Start play or pause whatever has focus, LB/RB ±10 s; `←`/`→` step the settings menu's speed slider; Y only wakes the chrome; the volume slider stays out of its reach. With no control focused, `Enter` takes "Skip intro" or the "Next episode" bubble or screen when one shows, otherwise shows the chrome and gives play/pause keyboard focus, even when a click had focused it (the main button of the end or error overlay when one shows). A player control focused with the keyboard (a button, an option) is activated by `space` and `Enter` instead of play/pause, and the arrows move focus between the controls (§19: `←`/`→` along the control row, `↑`/`↓` between it, the timeline and the exit button); on the timeline `←`/`→` still seek; the volume slider, reached with `Tab` only, keeps its arrow keys; a control focused by a pointer leaves `space` to play/pause and the arrows to seeking, even after a key. Reaching a control with the keyboard wakes the chrome, which fades again after the idle delay like after any key (it stays while a menu is open); once it has faded, the focused control rests: the arrows seek and set the volume again, `Enter` wakes the controls on play/pause. `Esc` steps back one level: an open menu closes; else keyboard focus leaves the controls and the chrome fades; else the page's own full screen is left (the desktop window's, §28.4; the browser's leaves by itself on `Esc`, through the page on a back key); else the player exits. A focused control that disappears ("Skip intro" once used, the "Next episode" bubble, a menu closed by a switch) hands focus to its menu's button, else to play/pause. A menu (chapters, settings, subtitles and audio) takes focus when it opens, on its checked option (the settings menu: its speed slider, which keeps `←`/`→`), and holds it: `Tab` cycles inside, `↑`/`↓` (`Home`/`End`) move between the options of a group, whose tab stop is the checked option, or between the chapters, and past either end, as from any other control, on to the menu's previous or next control, `Enter` or `space` picks one, `Esc` closes it and gives focus back to its button. Mobile: double tap left/right ±10 s, repeated taps add up, shown by a light ripple on that side; never shows the controls (a single tap toggles them once no second tap can follow). Vertical swipe for volume. Pinch in to close the player, like the close button (the video shrinks with the fingers; let go small enough or fast enough and it closes, otherwise it springs back; not while a menu or panel is open; pinching out does nothing). Volume remembered per device (`localStorage`).

**Playback info** (a debug view, for every user): `I`, or the switch at the bottom of the settings menu, shows a panel at the top left, under the exit button, that stays on screen when the chrome fades; remembered per device (`localStorage`), closed by its own button. Four groups, refreshed every 2 s (`watchPlaybackInfo` of `@projo/player`, never two reads at once):
- Session: the mode and, for `hls_transcode`, why (`transcodeReasons` of the session: video codec the client cannot play, lower quality, burn-in), the quality.
- File (`media` of the session, from the probe): container, size and average bitrate, video codec, profile, size, pixel format and dynamic range, the chosen audio track, the chosen subtitle track and how it is delivered.
- Sent by the server: video as is (`direct`), copied (`hls_remux`) or H.264 at the output height (`hls_transcode`); audio as is, copied or AAC; for an HLS session, the ffmpeg run from `GET /playback/sessions/:id/transcode` (same access rule as the heartbeat): running or not, where it encodes (GPU, CPU decoding and GPU encoding, CPU with the x264 preset), the encoding speed measured at the start of the run (shown as a warning below 1×), and HDR to SDR with or without tone mapping (§10.3).
- Player, what the engine sees (`PlayerEngine.stats`): decoded picture size and frame rate, codecs, hardware decoder (mpv `hwdec-current`), dropped frames (`getVideoPlaybackQuality`, mpv's output and decoder drops), hls.js bandwidth estimate, buffer ahead.

States to handle explicitly: initial loading, buffering, network error (automatic resume at the position), transcode limit reached, session stopped by the admin, end of the item without a next one (back to the title page after 5 s).

Decode fallback (§10.2), in `@projo/player` (`core/decode-fallback.ts`, the controller): an engine reports each fatal stream error with a kind (`StreamFailure.kind`): `network` (reconnection, as before), `decode` or `other` (blocking error with "Retry"). `html-video` reports `decode` for a `<video>` error `MEDIA_ERR_DECODE` (3) or `MEDIA_ERR_SRC_NOT_SUPPORTED` (4) (direct file, native HLS) and for a fatal hls.js `mediaError` or `muxError` once its own `recoverMediaError` has failed; `mpv` only reports `other`. On a `decode` failure that may fall back, the player switches like a quality change, with no message: the old session ends, the new one keeps the audio and subtitle tracks, the settings menu shows the quality it fell back to. Before the first frame of the failed session (it never reached `playing`), the new one starts where the failed one was to start, playing unless that one was to start paused; after it, at the current position, paused if it was. A transcode limit reached shows its error, as for a manual quality change. Choosing Original again stays possible; if it fails again, the error blocks.

Startup watch (`core/startup-watch.ts`, the controller through its `Timers`): an engine may refuse a stream without any error (Safari's native HLS dropping an HDR variant, §10.2), and the player would spin forever. So a session whose video is not transcoded (`direct`, `hls_remux`) that has not reached `playing` 15 s after the engine opened its stream is treated as a `decode` failure and goes through the decode fallback above (once per source, `decodeFallbackQuality`). "Opened" is the engine's `onOpened` of `PlayerEngine.load`: `html-video` calls it once the stream is handed to the media (a direct file's URL set, a native HLS playlist once the keyframe wait of §10.3 is over, hls.js's manifest parsed), so a slow keyframe index never counts; `mpv`, which always reports what it cannot play, never calls it. The watch stops at the session's first `playing`, when the stream is detached (track, quality or version change, retry, part, leaving) and when the session is ended. At the deadline, a session whose metadata is loaded and that is paused (started paused, an autoplay the browser refused, a pause before the start) waits for the user, not for the stream: nothing happens, and its next `play` starts the watch again. A stuck start that cannot fall back (a transcode, no quality below Original, a fallback already made for the source) keeps waiting rather than blocking: only an error the engine reports blocks.

**Logic and engines.** `@projo/player` holds everything that does not depend on what plays nor on what draws: playback sessions and heartbeats (§10.6), track, quality and version changes, the §12.4 automatic skips and countdown, next episode, chained parts, track memory reports (§11.3), the timeline, seek stalls. `createPlayerController` drives a `PlayerEngine` and exposes a store and actions; the interface reads the store and acts only through the actions, the same logic for every engine. An engine (`PlayerEngine`) holds the media state (`MediaState`: paused, ended, waiting, current time, duration, buffered end, volume, muted, ready, playback rate, folded from `MediaEvent`s by the pure reducer), plays, pauses, seeks, sets volume and rate, loads a stream (HLS or direct URL, start position, autoplay), selects an audio or subtitle track in itself when it can, gives the `ClientCapabilities` of §10.2 for `POST /playback/sessions`, and declares its `EngineCapabilities`:

| Capability | Meaning | `html-video` (browser) | `mpv` (desktop app, §28) |
|---|---|---|---|
| `pictureInPicture` | Picture-in-Picture (and document Picture-in-Picture) | where supported, not on phones | no |
| `airPlay` | AirPlay button | when Safari reports a receiver | no |
| `nativeFullscreen` | the element's full screen through the browser | yes | no: full screen is the window's (§28.4) |
| `subtitles` | who draws subtitles: `overlay` (the interface, from the `<track>` cues), `hls` (the platform, inside HLS), `engine` (the engine) | `overlay`, or `hls` in Safari on iPhone and iPad (a session may still be `track`, §10.4: the interface follows the session's `subtitleDelivery`) | `engine` |
| `switchesAudioInPlace` | an audio change in a `direct` session needs no new session (§10.2) | no | yes |
| `rendersBehindPage` | the picture is drawn under the page, not in it | no | yes |
| `backdropBlur` | `backdrop-filter` sees the picture | yes | no |

The interface decides on these capabilities, never on the engine's name. Over an engine that `rendersBehindPage` and lacks `backdropBlur` (mpv):
- No Picture-in-Picture and no AirPlay button (no Now Playing either: no media element, §28.9).
- The page is transparent over the picture once libmpv has drawn the file's first frame (its first `playback-restart`); until then the player stays opaque black, so the transparent window never shows the desktop. The player page, its ancestors and the document background then let it through, and only the chrome, menus, toasts, the "Skip intro" button, the countdown bubble and the "Next episode" screen are painted. Where the interface sizes the video (the "Next episode" thumbnail), the engine places the picture in that rectangle (mpv `video-margin-ratio-left|right|top|bottom`) and the page leaves it transparent.
- Glass materials (`--material-glass*`, `--blur-glass*`) become an opaque material (`--material-opaque`): `backdrop-filter` cannot see a native picture and would only leave a flat tint. The player's menus and panels become opaque too: their nearly opaque fill, meant to sit over a blurred picture, is not readable over a sharp one.
- Subtitles are the engine's (§10.4); the interface moves them above the countdown bubble (§12.4) through the engine (mpv `sub-pos`).
- An audio change in a `direct` session is made in the engine (§10.2); the player still reports it as a manual change (§11.3, toast included). A subtitle change is always made in the engine (§10.4).

---

## 11. Audio and subtitle selection

### 11.1 What the profile declares

Four settings, a single screen:

1. **Preferred audio language** (default: interface language).
2. **Preferred subtitle language** (default: interface language).
3. **Subtitle mode**: `never`, `always`, `when_audio_differs` (default), `forced_only`.
4. **Anime in original language with subtitles** (`anime_original_audio`, bool, default true): for an anime, the wanted audio becomes the original language and subtitles in the preferred language are turned on. An anime = Animation genre and original language `ja` (same definition as the home page's Anime row, §13.3); for an episode, those of its show. A live-action Japanese movie is not one.

No rule builder. If more exceptions turn out to be needed, they will take the form of a list of original languages, not a rule engine.

### 11.2 Cascade when opening a file

From most specific to most general:

1. **Show memory** (`track_preferences` on the show item for this profile; for a movie, on the movie): if the profile manually changed a track on any episode of the show, that choice applies.
2. Otherwise the **anime** rule (§11.1) if the work is one.
3. Otherwise the **profile defaults**.
4. **Resolution on the actual tracks** (pure function in `core/playback/resolve-tracks.ts`):
   - Audio: track in the wanted language (prefer the one marked `default`, then the most channels); failing that the track in the work's original language; failing that the file's `default` track; failing that the first one.
   - Subtitles: if the mode is `never`, none. If `always`, or if `when_audio_differs` and the chosen audio is not in the preferred subtitle language: track in the preferred language (external before embedded, non-SDH before SDH, non-forced before forced). If the chosen audio **is** in the preferred language (or `forced_only` mode): only a `forced` track in that language if it exists.
   - Tracks without a language tag (`und` or absent) are never picked automatically, unless it is the only track of its type. Audio: if all tracks are untagged, the `default` one (otherwise the first) is played.
   - Details: a `forced` track only comes after all full tracks (then external before embedded, non-SDH before SDH); an audio of unknown language counts as being in the preferred language (no full subtitles in `when_audio_differs`); a language missing from the memory lets the next level decide for that type; a bitmap track is only picked if `burn_in_enabled`.
   - A track named by the request (`audioStreamIndex`, `subtitleTrackId`, `off`) wins (`trackSelection = explicit`); a `subtitleTrackId` from another source (previous part, other version) is replaced by the equivalent track (language, forced, SDH); a track missing from the file is ignored. Bitmap requested with burn-in disabled: `playback/subtitle_unsupported`.

### 11.3 Manual change during playback

A change of audio or subtitle track (turning them off included) writes `track_preferences` for the show (or the movie) and shows an "Applied to the whole show" toast with the actions "Set as default for my profile" (which updates the profile settings) and "Undo". A change never modifies the profile defaults without that explicit action. A change the engine makes in place, without a new session (the desktop app, §10.2, §10.4), is reported and shown the same way. API: `PUT /items/:id/track-preferences` (`:id` = movie or episode, stored on the movie or the show; languages normalised to ISO 639-1), "Undo" = `DELETE /items/:id/track-preferences` (204, idempotent); "Set as default" = `PATCH /profiles/:id` (`audioLanguage`, `subtitleLanguage`, `subtitleMode`).

---

## 12. Intros, credits and segments

### 12.1 Model

A segment = (item, type, start, end, origin, confidence). Types: `intro`, `recap`, `credits`, `preview`. An item can have at most one segment per type; a new segment replaces the old one only if its origin has a higher or equal priority (manual > chapter > community databases > fingerprint).

A **negative marker** (`segment_lookups.outcome = no_segment`, row `provider = no_segment:<type>`) means "this work does not have this segment": it is honoured and stops the chain for that type. The admin sets it from the markers ("No intro").

### 12.2 Resolution chain

Started by the `fetch_segments` job after the enrichment of an episode or a movie, or after a matching without result (unidentified file: only its chapters are used), if `detect_segments` on the library, then by `fingerprint_season` if needed. A daily catch-up (400 items) retries items never resolved and stale answers. Order:

| # | Source | Details |
|---|---|---|
| 1 | Manual marker | set by the admin on an episode, with "Apply to the whole season" (copied to the other episodes, except those already manual) |
| 2 | File chapters | if chapters named `Intro`, `Opening`, `OP`, `Ending`, `ED`, `Credits`, `Recap`, `Preview` exist (case-insensitive) |
| 3 | TheIntroDB | `GET /v4/media` with `tvdb_id` (otherwise `tmdb_id`, `imdb_id`), season, episode, the file's `duration_ms`. Without a key: 500 req/day/IP according to the OpenAPI (the `X-UsageLimit-Limit` headers announce 5,000), 30 per 10 s. Optional admin key (`settings.theintrodb_api_key`): 1,000/day per account according to the OpenAPI, required to contribute. Types intro, recap, credits, preview. Checked on 2026-10-24. |
| 4 | IntroDB | `GET /segments` with `imdb_id`, season, episode (movies: `is_movie=true`). Read without a key. Types intro, recap, outro, post_credits. Queried episode by episode only, never in bulk. |
| 5 | SkipDB | `GET https://api.skipdb.tv/api/segments` with `imdb_id`, season, episode, `duration` (seconds). Read without a key, 120/min. Types intro, recap, outro, preview. |
| 6 | Local fingerprinting | see §12.3, only for episodes without a result and without a negative marker |
| 7 | Fallback | no segment: the player offers "Next episode" when less than 90 s or 2 % of the duration remain, never beyond the last 10 % (a short file does not show it from its first third) |

Each provider is an adapter of the `SegmentProvider` port (`lookup(itemRef, fileDurationMs) → Result<SegmentLookup, ProviderError>`), which can be enabled in the admin (`settings.segment_providers = ['theintrodb','introdb','skipdb']`, ordered). The first one returning a confirmed segment wins for that type; missing types continue the chain. An absence declared by a provider (TheIntroDB: zero-duration entry, IntroDB: `no_intro`, SkipDB: `0/0`) is not a negative marker: the databases contradict each other, the chain continues; only the admin sets a negative marker. Results and absences are cached (`segment_lookups`), retried after 30 days for `none`, 7 days for `error`, never for `found`.

Usage constraints to honour (ToS checked on 2026-10-23): local cache only, never re-exposed outside the players of this server, no dump, no redistribution (TheIntroDB and IntroDB; SkipDB publishes its data under ODbL, and any contribution is published there under that licence), attribution "Intro and credits markers provided by TheIntroDB, IntroDB and SkipDB" on the About page. A hosted or commercial use would require a written agreement with TheIntroDB and IntroDB.

### 12.3 Local fingerprinting

`fingerprint_season` job (whole season, only one in parallel, low priority, after all scan jobs):

1. Targets: the season's visible episodes without an `intro` segment (and without a negative marker); references: the other episodes of the season, up to 6, the closest by number. For each target and reference: extract the audio of the first `N` minutes (default 10) as 16 kHz mono WAV through ffmpeg, compute the Chromaprint fingerprint (`fpcalc -raw -length <N*60>`).
2. Compare each pair of episodes with a sliding window (Hamming distance on the 32-bit sub-fingerprints, configurable similarity threshold); keep the longest common sequence ≥ 15 s and ≤ 150 s.
3. A segment is accepted for an episode if it is corroborated by at least one other episode of the season (2 episodes minimum).
4. Same method on the last `M` minutes (default 5) for `credits`.
5. Origin `fingerprint`, confidence = proportion of corroborating episodes.

A single episode in the season: no fingerprinting. Thresholds are in `settings.fingerprint_*` and documented.

### 12.4 Player behaviour

- During an `intro` or `recap` segment: "Skip intro" (or "Skip recap") button at the bottom right, visible for 8 s then shrunk to an icon, click or `S` jumps to the end of the segment. If `auto_skip_intro`, automatic jump with an "Intro skipped" toast.
- On entering `credits` (or on fallback): a compact "Next episode in N s" bubble in the bottom right corner, over the video that keeps playing, with a 10 s countdown shown by a ring; at 0 the next episode starts. A click on the bubble starts it now; its close button ("Watch the credits") cancels the countdown and hides the bubble for the rest of the episode, even after seeking back before the credits. Seeking back before the credits hides the bubble; coming back into them starts the countdown over. `auto_skip_credits` shortens the countdown to 5 s (never 0: no jump without warning). `autoplay_next = false` shows the bubble without a countdown, as a shortcut. The countdown runs while the video plays, whether the controls are shown or not, in Picture-in-Picture (where the bubble cannot be seen) and in a hidden tab; a pause holds it. At the end of the file, the full "Next episode" screen (§10.7) follows, with the countdown still running or a new one if the bubble was closed. A movie or the last episode has no next item: neither bubble nor screen, the end of the item returns to the title page (§10.7).
- `preview` segment (preview of the next episode at the end of the file): treated like `credits` for triggering "next".
- Marking "watched": at 93 % of the duration **or** on entering `credits`, whichever comes first.

### 12.5 Manual markers and contribution

On an episode or a movie, the admin sets or adjusts one segment per type with two time fields and a preview, and "Apply to the whole season" (intro and recap at the same time; credits and preview at the same distance from each episode's end). Manual markers are exported in the backup like everything else.

Contributing back: `settings.segment_contribution = off | manual_only` (default `off`). When enabled, markers of origin `manual` are submitted to TheIntroDB (admin key required) and to SkipDB (anonymous key created automatically). Never the results of fingerprinting or chapters. Each submission is logged.

---

## 13. Progress, home, navigation

### 13.1 Progress rules

| Rule | Value |
|---|---|
| Position saved | at every heartbeat (10 s), pause, seek, close |
| "Resume" offered | position between 2 % and 93 % of the duration |
| Marked "watched" | position ≥ 93 % or entry into `credits`; `play_count` incremented |
| Playing a watched item | starts from 0 |
| Continue watching | one card per movie **in progress** (position between 2 % and 93 %) and one per started show: its episode in progress played last, otherwise its next episode (below); sorted by last activity (`last_played_at` of the movie, latest play on the show), 20 max |
| Next episode of a show | for a started show without an episode in progress: the first **unwatched** episode after the last watched one (airing order, missing episodes skipped), otherwise the show's first unwatched episode; never an already watched episode (rewatching E1 after E1–E3 offers the first unwatched one after E1). Watched episodes whose files were deleted still count: the show stays started and the next present episode follows them (season 1 deleted, season 2 arrives: S2 · E1 with the badge below). Same rule for the hero and the show page's "Play"; "New episode" badge if its file arrived after the show was last played |
| Leaving the row | movie watched; show whose present episodes are all watched; "Remove" action (`hidden_from_continue` on the item or the show, reset on the next playback) |
| Mark watched / unwatched | manual on movie, episode, season, show; "unwatched" resets the position to 0 |

### 13.2 Navigation

Matches the `Home` artboard: a pill navigation **Home · Shows · Movies · My list**, a **Search** button (icon, opens search as an overlay, `/` shortcut), and the profile avatar (menu: switch profile, profile settings, account and devices, administration if admin role, sign out). On mobile (`MobileHome`): bottom bar Home · Shows · Movies · My list · Search, avatar at the top.

### 13.3 Home

This is the screen that matters: 90 % of usage. Matches the `Home` artboard. Fixed rows, in this order, an empty row is omitted:

1. **Hero**: the first card of Continue watching, failing that a recent addition the profile has not removed ("Remove", `hidden_from_continue`). Full-screen backdrop, the title's TMDB logo (text if absent), metadata line (type and season, year, rating, genres), short overview, "Play"/"Resume S2 · E4", "More info", My list buttons. **Video preview**: on desktop, after 2 s without interaction, a clip of the item plays in a loop, muted, over the backdrop, with a "Turn on preview sound" button; the clip is produced by the `preview_clip` job (20 s from 25 % of the duration, 720p H.264 AAC, about 3 MB, cache `/data/cache/previews/<item>.mp4`); without a ready clip, the hero stays static; never a preview on mobile nor with `prefers-reduced-motion`. `GET /home` carries `hero.previewUrl` (`/api/v1/previews/:itemId.mp4`, with `Range`) when the clip of the movie or show is ready, made from the current version of the file and visible to the profile; otherwise it is requested (at most every 6 h per item), as for Continue watching items without a clip. Desktop = fine pointer and window wider than 640 px; "without interaction" = no click, no key, no scroll.
2. **Continue watching**: 16:9 cards (the §10.5 timeline thumbnail at the resume position when sprites exist, otherwise still or backdrop; `resumeFrame` of `GET /home`: `GET /trickplay/:sourceId/frames/:second.webp`, a 640 px WebP still of the video's exact frame at that thumbnail instant, extracted on the first request and kept with the sprites, which gate it and take it with them when rebuilt), progress bar, "S2 · E4 “Title”", "18 min left"; a show's next episode (§13.1) without a bar, its duration, "New episode" badge. A card starts playback.
3. **Recently added**: 2:3 posters, movies and shows mixed, sorted by `added_at` (a show moves up when a new episode becomes ready), "See all ›" link to Movies or Shows sorted by addition.
4. **My list**: 16:9 cards, "See all ›" link to the My list page.
5. **Categories**: below the fixed rows, rows of 2:3 posters mixing movies and shows, one per category: **Anime** (`animation` genre and Japanese original language, rule of §11.1), then one per genre (§9.1), titled with the genre label; the Animation row excludes anime. A category only appears with at least 6 titles visible to the profile; Anime first, then genres by descending number of visible titles (order of the §9.1 ids on ties), 12 rows at most. Each row: 20 titles at most, by descending TMDB score (`vote_average`; titles without a score after the scored ones), then descending `added_at`, watched titles (watched movie, show whose present episodes are all watched) last. Loaded in batches of 4 rows (`GET /home/categories`): the first arrives with the home page, the next ones when nearing the bottom of the page, the space of the awaited batch reserved by row skeletons; after the last batch, no more requests. Each category row has "See all ›", leading to the **category page** (`/categories/anime`, `/categories/<§9.1 genre id>`): the poster grid of §13.4 titled like the row, with every title of the category visible to the profile, movies and shows mixed, in the row's order (descending score, then `added_at`, watched titles last), without sort or filter (`GET /home/categories/:category`); the Animation page excludes anime as its row does. A category under the 6-title minimum keeps its page (empty state without any title).

Each card, on hover or focus, reveals its actions: Play, More info, Add to / Remove from My list (on an episode card of Continue watching: its show's My list), Mark as watched; the preview also shows the TMDB score (star and "7.9", absent without votes), the genres and the best quality ("4K HDR"), and for a show "Show · 2 seasons · 2023 – 2025". On mobile, a long press opens a sheet with the same actions and the score. No personalisation, no recommendation, no "trending": categories only depend on the profile's visible catalogue (§14).

### 13.4 Movies and Shows

Poster grid, virtualised scrolling, sorting (addition, title, year, score) and filters (genre, by §9.1 id, labels sorted in the interface language; year or decade bounded by the years present in the profile's catalogue, watched / unwatched / in progress), in a "Filters" panel on mobile. State persisted per profile and per device. **My list** is a page of the same kind, sorted by date added to the list. The category pages (§13.3) too, without sort or filter.

### 13.5 Title pages

- **Actions** (movie, show, episode): one primary action ("Play" / "Resume"), the frequent actions as visible buttons after it, and the rare ones in a "⋮" menu ending the row ("More" on a phone). The menu is everyone's: "From the beginning" (only when it differs from the primary action: a movie or episode in progress, a started show), then, for the admin only, after a separator, Fix the match, Edit, Refresh, Markers (never as buttons of the row); without any entry, no "⋮". When resuming, the progress line under the actions is the home hero's (§13.3): "S2 · E4 “Title”" for an episode, bar, "18 min left"; on a phone it sits right under the primary button.
- **Movie**: backdrop, logo or title, year, runtime, rating, TMDB score, genres, overview, "Play" or "Resume at 1:12", My list, Mark watched, "⋮", versions (if several), available tracks (audio and subtitle languages), cast.
- **Show** (`Series` and `MobileSeries` artboards): at the top "Resume S2 · E4" (or "Play" on the first unwatched episode), "My list", "⋮" ("From the beginning" plays the first episode from 0), rating and best available quality ("4K HDR") badges, TMDB score, years, number of seasons, genres, cast and creator. Then season tabs (from two seasons; a single season has no tab, its list is titled "Episodes", or the season's own label when it is not season 1), "x of n watched" counter and "12 / 22 episodes" when files are missing, a "⋯" menu of bulk actions (mark the season watched or unwatched, by its state; mark the show watched; mark the show unwatched), and the episode list: number, 16:9 still with progress bar, title, TMDB score of the episode, runtime, overview, "In progress · 18 min left", "Watched" check mark.
- **Rating badge** (hero, card preview and sheet, title pages): composed by the web in the interface language from the code, the country and the tier (§9.1). Tier `0` (`TP`, `U`, `G`…): `TP` / `ALL`, "All audiences"; age code (`10`, `12`, `16`): the code, "Not recommended under 12"; other code: the code, followed by its country when it is not the interface language's (`fr` → FR, `en` → US), i.e. `R (US)` in French, "Rated R (United States) · 18 and over"; unrated (`NR`): no badge. The full label is the badge's accessible name and tooltip.
- **Search**: instant results from 2 characters, local, on title, original title and show title, accent-insensitive (FTS5 with the `unicode61 remove_diacritics 2` tokenizer), movies and shows separated, 30 results max. No search on the overview or the cast.

### 13.6 Profiles

"Who's watching?" screen (`Main` artboard) only on the first sign-in on a device when the account has several profiles, otherwise the last profile used on this device is restored (`sessions.last_profile_id`). Switching through the avatar menu. A profile with a PIN shows a padlock on its avatar and asks for the PIN at each switch to it. The screen offers "Add" (up to 5) and "Manage profiles", except from a restricted profile (or, before choosing, on an account that has one, §14): it then only switches profiles. An avatar = the initial of the name on a coloured tile (six named colours: Slate, Blue, Honey, Sage, Terracotta, Purple), no image. A profile is created, renamed, recoloured and deleted (with confirmation, its progress is lost) from the profiles screen.

---

## 14. Accounts, profiles, authentication

- **Account**: username (3 to 32 characters, letters, digits, `.`, `_`, `-`), password (12 characters minimum, argon2id through `Bun.password`), role `admin` or `user`. No e-mail, no "forgot password": the admin resets it.
- **First account**: created by the first-launch wizard, always admin. An admin cannot demote themselves if they are the last admin.
- **Invitations**: the admin generates a single-use link, expiring after 7 days, shown only once (only the hash is stored). Deleting the admin who created it keeps the invitation and its history, without a creator (`created_by` cleared). The link leads to a username + password form, then to creating the first profile.
- **Profiles**: 1 to 5 per account (counted and inserted in the same transaction: parallel creations do not exceed 5), name, avatar colour among six (the avatar is the initial on a coloured tile, no image or upload), optional 4-digit PIN (argon2id), settings of §11.1 and §12.4, interface language.
- **Per-profile library access**: `profiles.library_access = all` or an explicit list (`profile_libraries`), set by the admin from the library ("Profiles with access") or from the profile. Anything outside the access does not exist for that profile (home, title pages, search, API, images).
- **Per-profile maximum rating**: empty (no limit) or a tier of the rating country's scale (for France: All audiences, 10, 12, 16, 18). An item whose rating exceeds the tier, or whose rating is unknown when a tier is set, does not exist for that profile. Together with the PIN on the other profiles, this is v1's kids profile.
- **Per-profile Live TV access**: a switch, on by default, set like library access by an admin from an unrestricted profile only (§29.6); not a restriction in the sense below.
- **Restricted profile** (selected libraries or maximum rating): it performs no account-level action, 403 `profile/restricted`: revoking sessions or devices, creating a bearer token, changing the password, creating, editing or deleting another profile, setting or removing a PIN (its own included). It edits its own settings unrelated to access (name, colour, languages, subtitles, autoplay…) and can restrict its access further, never widen it. The web hides "Account and devices" and profile management for it. **Without a resolved active profile** (`X-Profile-Id` refused: PIN not unlocked, foreign or unknown profile; "Who's watching?" not answered yet), the account acts as its most restricted profile: never any widening, and account actions are refused as soon as one of its profiles is restricted. Widening access requires an admin acting from a resolved active profile without restrictions.
- **Sessions**: `projo_session` cookie, httpOnly, `Secure` if the request is over HTTPS (direct or through `TRUST_PROXY`), `SameSite=Lax`, sliding 30-day lifetime, renewed on each request more than 24 h after the previous one. Same table for the bearer tokens (`Authorization: Bearer`) meant for the mobile app (§26), with the same sliding 30-day lifetime, created with a device name by `POST /auth/tokens`, by `POST /auth/login` with `token: true` (the token is returned, no cookie is set) or by claiming a pairing code. Users see their devices (name, browser, last activity) and revoke them; the admin can revoke all sessions of an account. The assistants of the MCP server (tokens and OAuth connections) are apart, valid on `/mcp` only; revoking all sessions revokes them too (§27.3).
- **Pairing a device**: "Account and devices" → "Connect a device" calls `POST /auth/pairings` (account action: 403 `profile/restricted` from a restricted profile) and shows, for 5 minutes, a 6-character code (alphabet without `0 O 1 I`) and a QR code of `<origin>/pair?code=<code>`, with that origin written under it: the app keeps it as its server URL. When the origin is a local address (`localhost`, a loopback, private or link-local IP, a `.local` name), the dialog warns that the device will then only reach projo from home, and to open projo by its public address to pair a device used outside. The dialog lists the device as soon as it is claimed (`pairing.claimed`, SSE to the session that created the code). The app scans it (or takes the server URL and the code typed in) and calls `POST /auth/pairings/claim` (`{ code, deviceName }`, public, 10 attempts per 15 min per IP) → `{ token }`, a bearer session of the account that created the code. A code is single-use, only its hash is stored, at most 3 live codes per account, and revoking the session that created it voids it. `/pair` on the web only says to open the projo app and scan the code.
- **Disabling**: a disabled account can no longer sign in, its sessions are revoked, its data is kept. Deletion: full cascade, confirmed by typing the username.
- Deleting an account or a profile, or disabling an account, first cleanly ends its active playback sessions (ffmpeg stopped, `playback.session_terminated`).

---

## 15. Administration

Available to `admin` accounts through the avatar menu, same language and same design as the rest, not a separate app. Only from an active profile without restrictions (all libraries, no maximum rating): otherwise, or without a resolved active profile, 403 `auth/restricted_profile`, and the "Administration" link of the avatar menu is hidden.

| Section | Content |
|---|---|
| **First launch** | 2-step wizard: admin account, then folders of the first library (folder browser, name prefilled from the folder). No setting is shown there: server name `projo`, metadata language derived from the interface language, library in `auto` with the §6.2 defaults; everything can be changed later in the admin. Starts the first scan. Only available as long as no account exists. |
| **Dashboard** | Counters (movies, shows, episodes, pending sources, to review, missing), running scans with progress, active sessions, unread notifications, app and runtime version, available update. |
| **Libraries** | `AdminLibraries` and `AdminAddLibrary` artboards. One card per library (name, content type, roots, counters, last scan, "analysis in progress" or error state, "Resync", "More options" menu), "Recent activity" feed (scans, ready files, alerts). Creation and editing: name, content type (Auto, Movies, Shows), roots with folder browser and used space, watch folders, interval, quiet period, detect intro and credits, extract embedded subtitles, generate playback bar previews, metadata language, country for ratings, profiles with access, "Create and start the analysis". Deletion with confirmation (deletes sources and orphan items, never the files), "Scan", "Full scan", history of the last 20 scans. **Analysis** = the whole pipeline (§7.2), not just discovery: `LibraryDto.analysis` (SQL on the `pending` sources of reachable roots) counts `waiting` (quiet period running), `verifying` (stable, probe queued or running), `failed` (`probe_failed`, `decode_failed`, `too_small`) and `nextReadyAt`; "Analysis in progress" (bar `ready / (ready + in progress)`, phase on one line) while the scan runs or `waiting + verifying > 0`, failures reported separately without blocking "Up to date"; same on a library's page and on the onboarding's "All set". |
| **Pending files** | `pending` sources: path, reason, size, since when, last change. Actions: force a recheck, hide (§7.8). |
| **To review** | `needs_review` sources, one row per series group (§7.8), in a table: a single file shows its name and path, what the parser understood, its reason, "Identify" and "Hide"; a group of several files shows "<show> · N files", the show folder, the reasons of its files, "Identify" (on its first file, mode episode: identifies the series) and "Hide" (the whole group, with confirmation), and clicking it unfolds its files below it as rows of the same table, each with its own actions (the page scrolls, no inner scroll). Built-in TMDB search, assignment, "it's a movie", "it's an episode of…" (§7.8). Pages of 50 groups ("More"). The counter (menu, title) counts files: the `total` returned by `GET /admin/sources` and `GET /admin/sources/review-groups`. |
| **Missing** | `missing` sources: path, since when, attached item. Purge one or all. |
| **Hidden** | `rejected` sources (§7.8): path, size. Action: show again. |
| **Accounts** | `AdminAccounts` artboard. List of accounts with their profiles (avatar, account role, summary "Movies, Shows · 16 and over", last activity and device, playing or not). Detail panel per profile: name, colour, accessible libraries, maximum rating, autoplay episodes, skip intros, protect with a PIN code, "Delete the profile". Per account: role, pending invitations, create an invitation, reset a password, disable, delete, revoke sessions, add a profile (5 max). List as a table; an account's details (settings + profiles) open in a dialog when clicking its row. |
| **Active sessions** | Who watches what, mode (direct, remux, transcode), quality, device, position. Stop a session. |
| **Playback** | Max simultaneous transcodes, audio downmix, subtitle burn-in, max transcoding cache size, trickplay on/off, hardware transcoding (VAAPI, §10.3), live TV replay window and max live cache size (§29.4). |
| **Intros and credits** | Enabled providers and order, TheIntroDB key, fingerprinting on/off and thresholds, contribution on/off. |
| **Metadata** | Language, TMDB key (replacement; state `missing` \| `valid` \| `rejected` — `rejected` when TMDB answered 401 to the saved key since it was validated, also reported by the admin banner), "Refresh the whole library". |
| **Updates** | Current version, last check, available version and release notes, "Check now", "Update", versions on disk with "Go back to this version", update log. |
| **Server** | Name, port shown (read-only), `TRUST_PROXY` shown, data folder and space used per category, export the database, "AI assistants" (tokens and OAuth connections of the MCP server, §27.3). |
| **Jobs** | List of queued, running, failed jobs (type, target, state, attempts, error with code and context), retry, cancel. Target: name of the library, the file or the version; an item or a season arrives in parts (own title, show, numbers) and the web composes the line (`Severance · S2 · E4`, `Severance · Season 2`). Pages of 50, laid out like Logs. |
| **Logs** | The lines the server logs (those written on stdout, at `LOG_LEVEL`), kept 14 days and at most 500,000 lines in `/data/logs/logs.db`: its own SQLite file, written in batches every second, never in the database's exports or backups; when it cannot be opened, the lines of the current run are kept in memory. A table, newest first: date (to the second), level, message, and on a second line the code, the module and, for a request, method, path and status. Filters: minimum level (All, Info, Warnings, Errors), period (last hour, last 24 hours by default, last 7 days, all, custom range), text searched in the message, the code and the fields. The table fills the window's height: its rows scroll under a header that stays, and pages of 100 lines are turned below it (previous, next; a phone scrolls the whole page instead). Other filters start again from the first page. "Refresh" goes back to the newest lines. A row opens the line with all its fields. "Export" downloads the filtered lines oldest first as NDJSON, one JSON object per line as on stdout (`projo-logs-<date>.ndjson`). Also read by the MCP server (§27.4). |
| **Notifications** | Notification centre: unread, read, resolved. Badge in the menu. |

Notifications emitted in v1: `library/root_unreachable`, `scan/source_stuck_pending`, `scan/unsupported_layout`, `scan/needs_review_count` (daily if > 0), `scan/many_missing` (§7.5), `metadata/tmdb_key_missing`, `update/available`, `update/runtime_too_old`, `update/failed`, `update/rolled_back`, `job/failed` (after the last attempt), `tmdb/unauthorized`, `cache/disk_low` (less than 2 GB free on `/data`), `playback/hw_accel_failed` (§10.3). Reference list: `notificationKinds` of `packages/shared/api/notifications.ts`.

---

## 16. Updates from the admin

### 16.1 Principle

The Docker image is a **runtime**: Bun, ffmpeg, ffprobe, fpcalc, and a supervisor. The application is a pure, universal JS **bundle**, installed in `/data/app/versions/<version>/`. The admin updates the app without touching the container. Runtime updates (new version of Bun or ffmpeg) remain image updates, rare, announced in the release notes.

### 16.2 Release format

On the GitHub Releases of the `LeoMartinDev/projo` repository, tag `v<semver>`:

- `projo-app-<version>.tar.gz`: `manifest.json`, `server.js` (output of `bun build --target=bun`), `public/` (built web), `drizzle/` (migrations), `locales/`, `avatars/`.
- `SHA256SUMS`.
- `manifest.json`: `{ version, runtimeMin, builtAt, files: { path: sha256 } }`, in the archive and also published next to it (listed in `SHA256SUMS`): `check_updates` reads `runtimeMin` there without downloading the archive.

The runtime also ships the app version it was published with, in `/opt/projo/app/`, used on first start if `/data/app` is empty.

### 16.3 Supervisor

Bun script in the image (`runtime/supervisor/main.ts`, no npm dependency), started by `tini → entrypoint.sh`. The container starts as root only to `chown` `/data` if it does not belong to the `projo` user (uid 1000, a bind mount created by Docker), then switches to `projo`: the supervisor and the app never run as root.

1. If `/data/app/current` does not exist or points to an invalid version: copies `/opt/projo/app` to `versions/<v>` and creates `current`.
2. Starts `bun /data/app/versions/<v>/server.js` (real path resolved from `current`, so that a switch does not touch the running app), relays stdout/stderr, restarts the process if it dies (backoff 1 s, 5 s, 30 s).
3. Exit code **75** = "switch requested": the supervisor reads `/data/app/pending` (the version, `1.4.0`, installed in `versions/<v>`), backs up the database (`db/backups/projo-<old>.db`), points `current` to the requested version, restarts, and waits for `/health` OK for 60 s. If OK: the old version becomes `previous`, at most the last 2 are kept, only this switch's database copy is kept, success logged. Otherwise: `current` pointed back to the old one, database restored from the backup, restart. In both cases it deletes `pending` and writes `/data/app/switch-result.json` (`{ fromVersion, toVersion, outcome: "switched" | "rolled_back", at, reason? }`); the supervisor never writes to the database (its schema belongs to the app versions): the app reads this file on startup, deletes it, and derives from it `app_versions` (`failed` for the refused version), the pending `update_runs` row and the `update/rolled_back` notification.
4. Migrations are run by the server on startup (Drizzle migrate, each migration in a transaction). A migration failure makes the server exit with a non-zero code: rollback through point 3.

### 16.4 Application side

- Daily `check_updates` job (and button): `GET https://api.github.com/repos/LeoMartinDev/projo/releases/latest`, compares with the current semver, checks `runtimeMin` against the runtime version (exposed by the supervisor through a `PROJO_RUNTIME_VERSION` environment variable). If the runtime is too old: `update/runtime_too_old` notification with the `docker pull` command to run, no "Update" button.
- "Update": `apply_update` job: download into `staging/<v>`, check of `SHA256SUMS` then of each manifest file, extraction into `versions/<v>`, writing `pending`, exit 75. The player of users in direct play is not affected; HLS sessions are interrupted and resume automatically (client reconnection, resume at the position).
- "Go back to this version": same mechanism with a version already present.
- `stable` channel only in v1 (`settings.update_channel` exists for v2).
- In development (`bun run dev`), the updater is disabled.
- The update banner shows what the host's update source offers (`AppHost.updates`, §5.2); in the browser it is the following. On the desktop app it is the app's own update (§28.10).
- Web clients follow the server's version: the web build carries its version (`PROJO_VERSION`, else the root `package.json`; `<meta name="projo-version">`, checked by `build-bundle`) and compares it to `/health` at launch, when it comes back to the foreground and when the event stream reconnects. Different: at launch, in the foreground or in the background it activates the new service worker and reloads by itself; while the app is in use it shows a "New version available · Reload" banner, applied as soon as the app goes to the background; never during playback (no banner on the player). A reload that did not bring the version drops the service worker and its caches once, then stops trying for the session.

---

## 17. API

### 17.1 Conventions

- `/api/v1` prefix, JSON, shared Zod schemas (`packages/shared/api/`), typed client `hc<AppType>`.
- Authentication: session cookie or `Authorization: Bearer`. The active profile is sent in the `X-Profile-Id` header and checked as belonging to the account. A bearer session also gets a media key (`mediaKey` of `GET /auth/me`), accepted as `?key=` on the media routes only (§20).
- Cross-origin: `/health` and `/api/v1/*` (stream capability URLs for `GET` and `HEAD` only) answer CORS to the desktop origins only (`desktopOrigins` of `@projo/shared/api/desktop`, §20); every other caller is same-origin or sends no `Origin` (the mobile app).
- Errors: `{ error: { code, message, context? } }` with the status from the mapping table. Cursor pagination (`?cursor=&limit=`), filters in the query.
- SSE: `GET /api/v1/events` (events: `scan.progress`, `scan.finished`, `source.ready`, `job.updated`, `notification.created`, `playback.session_terminated`, `pairing.claimed`, `update.state`, `catalog.changed`), filtered by audience: `admin` (including `scan.*` and `source.ready`), `everyone`, or only the session concerned. The audience is re-read at each event: an admin demoted or switched to a restricted profile (the stream's profile is the session's last profile) no longer receives admin events, a disabled account or a revoked session loses the stream. `catalog.changed` (audience `everyone`, no details): the catalogue changed (source ready, scan finished, `match_source` or `fetch_images` job finished), grouped on the server (at most one every 2 s, at the end of a burst); the web then reloads its catalogue queries (Movies, Shows, Home, title pages), at most every 1.5 s. `scan.progress` carries `phase` (`discovering` \| `processing`) and `total` when known, for a determinate bar. The admin follows the analysis (§15) by reloading the libraries on `source.ready` and on the end of `watch_pending` / `probe_source` jobs (`job.updated`), at most every 2 s.
- Everything admin is under `/api/v1/admin/` and requires the role.
- **Compatibility** (since the mobile app, §26.4): the server updates itself from the admin while the app updates through the App Store, so `/api/v1` only changes additively: new routes, new optional request fields, new response fields. Never a removal, a rename, a change of meaning, a newly required field, or a new value of an existing response enum (except error codes: an unknown code shows the generic message). Anything else is `/api/v2`, served alongside v1.

### 17.2 Endpoints

| Domain | Endpoints |
|---|---|
| Setup | `GET /setup/status`, `POST /setup` |
| Auth | `POST /auth/login` (`token: true` → bearer, §14; required from a desktop origin, §20), `POST /auth/logout`, `GET /auth/me` (`mediaKey` for a bearer session, §20), `POST /auth/tokens`, `POST /auth/pairings`, `POST /auth/pairings/claim`, `GET /auth/sessions`, `DELETE /auth/sessions/:id`, `POST /auth/password`, `GET /invitations/:token`, `POST /invitations/:token/accept` |
| Profiles | `GET/POST /profiles`, `PATCH/DELETE /profiles/:id`, `POST /profiles/:id/verify-pin`, `POST /profiles/:id/select` |
| Catalogue | `GET /home`, `GET /home/categories?cursor=` (a batch of §13.3 category rows, `total` and `nextCursor`), `GET /home/categories/:category?cursor=&limit=` (`anime` or a genre id: a page of the titles of a §13.3 category page), `GET /movies`, `GET /series`, `GET /items/:id`, `GET /items/:id/children`, `GET /search?q=`, `GET /images/:id`, `GET /genres` (ids of the genres present, unsorted, and year bounds `years: { min, max }`) |
| Progress | `PUT /items/:id/progress`, `POST /items/:id/watched`, `DELETE /items/:id/watched`, `POST /items/:id/hide-from-continue`, `GET/POST/DELETE /watchlist/:itemId` |
| Playback | `POST /playback/sessions`, `PUT /playback/sessions/:id/heartbeat`, `DELETE /playback/sessions/:id`; under the session's capability prefix `/stream/:sessionId/:secret/` (§20, URLs returned by `POST /playback/sessions`): `master.m3u8`, `index.m3u8`, `:segment`, `direct`, `subtitles/:trackId.m3u8`, `subtitles/:trackId.vtt?subtitleOffsetMs=`, `tracks/:trackId.vtt` (sidecar `<track>`, §10.4); `GET /subtitles/:sourceId/:trackId.vtt` (the web's `<track>`), `GET /trickplay/:sourceId/index.json`, `GET /trickplay/:sourceId/:sheet.jpg`, `GET /trickplay/:sourceId/frames/:second.webp`; `GET /previews/:itemId.mp4`, `GET /items/:id/segments`, `PUT/DELETE /items/:id/track-preferences` |
| Admin libraries | `GET/POST /admin/libraries`, `GET/PATCH/DELETE /admin/libraries/:id`, `POST /admin/libraries/:id/scan`, `GET /admin/libraries/:id/scans`, `GET/PUT /admin/libraries/:id/profiles` ("Profiles with access", same `library_access` / `profile_libraries` as the profile), `GET /admin/fs/browse?path=` |
| Admin sources | `GET /admin/sources?libraryId=&state=&matchState=` (with `total` on every page), `POST /admin/sources/:id/recheck`, `POST /admin/sources/:id/assign`, `GET /admin/sources/review-groups?libraryId=&cursor=&limit=` (the "To review" list by series group, §7.8: `total` files, and per group its first file, `count`, show name, show folder, reasons), `GET /admin/sources/:id/review-group` (the files of that file's group, first file first), `POST /admin/sources/:id/reject` (hide), `POST /admin/sources/:id/reject-group` (hide the file's group, §7.8), `POST /admin/sources/:id/restore` (show again), `DELETE /admin/sources/:id`, `POST /admin/sources/purge-missing` |
| Admin items | `GET /admin/tmdb/search`, `POST /admin/items/:id/rematch`, `GET /admin/items/:id` (values and locked fields, for editing), `PATCH /admin/items/:id` (overrides), `POST /admin/libraries/:id/refresh-metadata` ("Refresh the whole library"), `DELETE /admin/items/:id/overrides/:field`, `POST /admin/items/:id/refresh`, `GET /admin/items/:id/images/alternatives`, `POST /admin/items/:id/images`, `PUT/DELETE /admin/items/:id/segments/:type`, `POST /admin/items/:id/segments/apply-to-season` |
| Admin accounts | `GET/POST /admin/accounts`, `PATCH/DELETE /admin/accounts/:id`, `POST /admin/accounts/:id/reset-password`, `POST /admin/accounts/:id/revoke-sessions`, `POST /admin/accounts/:id/profiles`, `GET/POST/DELETE /admin/invitations` |
| Admin operations | `GET /admin/playback/sessions`, `DELETE /admin/playback/sessions/:id`, `GET/PATCH /admin/settings`, `GET /admin/jobs`, `POST /admin/jobs/:id/retry`, `POST /admin/jobs/:id/cancel`, `GET /admin/logs` (filters `level`, `from`, `to`, `q`, cursor), `GET /admin/logs/export` (same filters, NDJSON), `GET /admin/notifications`, `POST /admin/notifications/:id/read`, `GET /admin/updates`, `POST /admin/updates/check`, `POST /admin/updates/apply`, `POST /admin/updates/rollback`, `GET /admin/stats`, `GET /admin/storage`, `POST /admin/db/export`, `POST /admin/images/optimize` |
| Admin assistants | `GET/POST /admin/assistant-tokens`, `DELETE /admin/assistant-tokens/:id` (§27.3) |
| System | `GET /health` (outside the prefix, no auth, CORS for the desktop origins: `{ status, version, runtime }`) |
| OAuth consent | `GET/POST /oauth/authorize` (§27.3; the page itself is the web's `/oauth/authorize`) |
| MCP and OAuth | Outside the prefix (§27): `POST /mcp`, `GET /.well-known/oauth-protected-resource`, `GET /.well-known/oauth-authorization-server`, `POST /oauth/register`, `POST /oauth/token` |

---

## 18. Jobs

Queue persisted in `jobs`, run in process by workers started by `entrypoints/jobs/`. Automatic recovery of `running` jobs on restart (put back to `queued`). A clean shutdown (`SIGTERM`, version switch) itself puts its interrupted jobs back to `queued` without counting the attempt; only those a crash left `running` count theirs (`failed` if they were on the last one). `apply_update` finishes (`done`) before exit 75.

| Type | Triggered by | Priority | Concurrency | Idempotence |
|---|---|---|---|---|
| `scan_library` | watcher, periodic, manual, startup | 50 | 1 per library | `dedupe_key = library:<id>` |
| `watch_pending` | end of a scan leaving `pending` sources, nearest quiet period deadline (§7.3), and scheduler every 30 s if there are `pending` sources | 60 | 1 | |
| `probe_source` | leaving quarantine | 70 | 2 | per source |
| `match_source` | after probing, full scan | 60 | 2 (limited by TMDB) | per source |
| `fetch_images` | after matching | 40 | 2 | per item |
| `index_keyframes` | first HLS playback (prio 100), or background | 100 / 20 | 1 | per source |
| `fetch_segments` | after enrichment | 30 | 1 | per item |
| `fingerprint_season` | after `fetch_segments` without result | 10 | 1 (heavy ffmpeg) | per season |
| `submit_segment` | manual marker set, if `segment_contribution = manual_only` (§12.5) | 20 | 1 | per item and type |
| `trickplay` | after enrichment | 10 | 1 (heavy ffmpeg) | per source |
| `preview_clip` | after the enrichment of a movie or a show (most recent episode), and when an item enters Continue watching without a clip | 10 | 1 (heavy ffmpeg) | per item |
| `extract_subtitles` | end of probing of a source of a `pre_extract_subtitles` library | 15 | 1 | per source |
| `refresh_metadata` | weekly (shows in production), manual, language or country changed (§9.4, prio 10) | 20 | 1 | per item |
| `check_updates` | daily, manual | 50 | 1 | singleton |
| `apply_update` | admin | 100 | 1 | singleton |
| `cleanup_cache` | hourly | 20 | 1 | singleton |
| `purge_missing` | daily | 20 | 1 | singleton |
| `image_variants` | by hand ("Optimize images") | 10 | 1 | singleton (missing variants only) |
| `refresh_tv_source` | source created, its settings changed, daily, manual (§29.2) | 40 | 1 | `dedupe_key = tv_source:<id>` |
| `fetch_tv_logos` | after `refresh_tv_source`, channels enabled (§29.2) | 30 | 1 | `dedupe_key = tv_logos:<id>` |
| `refresh_tv_guide` | hourly task for sources not read for 6 hours, after `refresh_tv_source`, channels enabled, XMLTV URL changed, a channel's guide channel chosen (§29.3) | 20 | 1 | `dedupe_key = tv_guide:<id>` |
| `fetch_tv_programme_images` | after `refresh_tv_guide`, every 15 minutes (§29.3) | 15 | 1 | singleton (`dedupe_key = tv_programme_images`) |

Rules: derived files (subtitles, trickplay, keyframe indexes, previews) of deleted sources, tracks and items are erased by the hourly `media-assets-cleanup` task. "Heavy ffmpeg" jobs (`fingerprint_season`, `trickplay`, `preview_clip`) run one at a time across the three types, and do not run while a transcode is active and the server has fewer than 4 cores; they resume afterwards. The ffmpeg, ffprobe and fpcalc processes of jobs run at the lowest CPU priority (nice 19), except `index_keyframes` when a player waits for it (priority 100); those of playback (transcode, remux, probe at session start, on-demand subtitles) keep the normal one. Attempts: 3 with exponential backoff, except `apply_update` (1). Each job publishes `progress` and an SSE event. A job that fails on its last attempt creates a notification with the error code. The hourly `purge-jobs` task deletes `done` jobs 7 days after they finish and `failed` / `cancelled` ones after 30 days; `queued` and `running` jobs are never purged. It also deletes notifications resolved more than 30 days ago and scan runs finished more than 30 days ago (each library keeps its latest). The daily `metadata-purge` task deletes the images nothing references any more (rows, files and WebP variants: their title was purged) and the `tmdb_responses` older than 30 days (no reader accepts an older one).

---

## 19. Interface, i18n, design

- **Reference design**: the design canvas copied in `design/artboards/` (seventeen artboards including the UI kit and the onboarding; inventory, tokens and components in `design/README.md`). It is the source of truth for layout, typography, colours, components and motion. Nothing is invented outside of it; a screen missing from the design (admin beyond the three drawn screens, settings, movie player, search) is built with the same components and tokens, and what is missing is asked for, not improvised.
- **Tokens** (extracted from the artboards): Geist font (Geist Mono for paths and sizes in the admin); background `#0A0A0B`, surfaces `#111113` and `#141416`, glass `rgba(255,255,255,.06 to .16)` with `backdrop-filter: blur`, text `#F4F4F5`, secondary text `#A1A1AA`, dimmed `#8B8B94` and `#71717A`, borders `rgba(255,255,255,.08 to .28)`; default accent `#F4F4F5` with variants `#7C83FF`, `#FF5A5F`, `#3DDC97`; error `#FF5A5F`; avatar colours Blue `#5B7FA6`, Terracotta `#A86A55`, Sage `#5E8C72`, Purple `#7D6AA6`, Honey `#B08A3E`, Slate `#5F6670`; radii 999 px (pills), 14 px (primary buttons), 12 px (cards), 10 px (thumbnails), 30 px (avatars); motion `cubic-bezier(.2,.7,.2,1)`, 0.8 s staggered fade-rise entrance, 26 s Ken Burns on backdrops, all turned off by `prefers-reduced-motion`.
- **Principles** when the design does not decide: dark, image first, few words, subtle motion, a single gesture for the main action.
- **Image formats**: 2:3 posters for Recently added, the home categories, Movies and Shows; 16:9 thumbnails with still for episodes, Continue watching and My list; backdrop + logo for the hero.
- **i18n** from the first screen: all strings in `apps/web/src/shared/i18n/<locale>.json` (moved to `packages/i18n` by M6, shared with the app, §26.2), including notification titles (`admin.notifications.<kind>`), genre (`genres.<id>`, §9.1) and edition (`editions.<id>`, §8.1) labels, the version label (§7.7), that of seasons, episodes and chapters without a name of their own (`item.season`, `item.specials`, `item.episodeNumber`, `player.menu.chapterNumber`, §6.3, §10.7), the rating badge (`contentRatings.*`, §13.5), the reason of an unreachable root (`admin.rootError.<reason>`, §7.5): the server only sends codes and ids, `fr` and `en` shipped, language per profile (default: browser language). API error codes are translated on the web. Localised dates and durations.
- **Theme**: dark only in v1, CSS variables ready for a light theme.
- **PWA**: manifest, icons, `display: standalone`, service worker limited to caching static assets (never streams nor the API): `sw.js` generated by the web build (`apps/web/vite-plugins/service-worker.ts`) precaches the build output (no source maps), serves every app navigation from the cached `index.html` and the precached files from the cache, leaves the server paths (`/api`, `/health`, `/mcp`, `/.well-known`, `/oauth/token|register`, `isServerPath` of `@projo/shared/api/web-app`) to the network. One cache per build, a new worker waits until the app activates it (§16.4). Requires a secure context (HTTPS or `localhost`): over plain HTTP on the network the app works without it.
- **Responsive**: mobile ≥ 360 px, tablet, desktop, adapted navigation (bottom bar on mobile).
- **Basic accessibility**: full keyboard navigation, AA contrast, visible focus readable from a couch: an accent ring `--focus-ring-width` (3 px) wide, 3 px off the control, on every focusable (the timeline, the volume slider, switches and chips included; inset in table rows and scrolling lists; a text field such as search shows it only when reached with the keyboard; a focused card's ring is drawn on its preview, which covers it). A navigation to another page moves focus to the page's main region (no ring), so the next `Tab` goes on in the page; going back (history, `Esc` out of the player) to a page left with the keyboard gives focus back to the element it was left from (the card, episode still or button) once rendered, given up after a few seconds or at a pointer press. Open menus take and hold focus (§10.7). Also `aria-label` on the player controls, `prefers-reduced-motion` honoured.
- **Couch navigation** (a remote, a gamepad's d-pad; the desktop app on a TV, §28, with no TV mode): the viewer's pages (profile picker, home, Movies, Shows, categories, My list, title pages, search, the player, profile and account settings) work with `↑ ↓ ← →`, `Enter` and `Esc`/`Backspace` alone; the admin and its forms stay keyboard pages, driven with `Tab`. An arrow moves focus to the nearest element that way, on the nearest line first; `←`/`→` never leave their line. A row (each home row, the hero's and a title page's actions, an episode of a title page, the header, the profiles, the player's controls) keeps `←`/`→` inside it, in order, and `↑`/`↓` leave it; it remembers its last focused element on the page, so `↓` then `↑` comes back to the same card (else its main action, an episode's still, else the element nearest the move); a row of cards is one `Tab` stop, that card; "See all" is `←` from the first card. With nothing focused, the first arrow or `Enter` focuses the page's primary element in view (the hero's "Play", a title page's main action, the profile in use or the first one, a grid's first title), else the first element in view, else the primary element. Focus scrolls into view below the header; `↑` reaches the header from the page's top; past the last element rendered, the page scrolls on (virtualised grids, rows loaded on demand). After a pointer press, the arrows scroll the page as before until another key is pressed. Keys stay with what handles them: text fields, number fields and text areas (a single-line text field gives `↑`/`↓` to leave it), sliders and radio inputs (`←`/`→`), scrolling boxes, lists and menus that move with the arrows (season tabs, the player's menus, a select's list, opened by `Enter`, `space` or `Alt+↓`); an open menu or popover holds the arrows; `Esc` closes an open dialog, sheet or menu first, `Backspace` too outside forms and dialogs. Otherwise `Esc`, `Backspace` (not in a form or a dialog) and the back keys (`BrowserBack`, `GoBack`, always taken from the browser) go back in history to an entry of the app, never from the home page. A card's hover actions stay out of the keyboard's way (the title page has them); the context-menu key or `Shift+F10` on a card opens its actions menu, and focus returns to the card when it closes. The player has its own keys (§10.7). These moves are intents (move, activate, back), which a gamepad sends too (Gamepad API, "standard" mapping; a secure context only, so the desktop app or HTTPS, and while the page shows and its window has focus): the d-pad and the left stick move (held, they repeat after 400 ms, then every 120 ms), A activates, B and View go back, Y opens the focused card's actions menu; in the player X and Start play or pause, LB/RB seek −10 s/+10 s. A pad with another mapping: the left stick, buttons 0 (A) and 1 (B). Several pads act as one. The pad steps through the lists and menus that keep the arrow keys; a tab or an option waits for A (passing over season tabs loads none), a radio input is chosen as it is reached. A direction held through a pause (page hidden, window unfocused) waits its delay again. The pad counts as the keyboard (focus rings, the player's chrome and keyboard focus).
- **States**: each screen defines its empty, loading (skeletons), error (message translated from the code) and offline (banner) states.

---

## 20. Security

- Passwords and PINs: argon2id (`Bun.password`), never logged.
- Sessions: httpOnly cookies, `SameSite=Lax`, `Secure` over HTTPS; check of the `Origin` header on every mutating request (`Origin: null` accepted only with `Sec-Fetch-Site: same-origin`, which the page cannot forge: WebKit's `sendBeacon`); bearer tokens shown only once, stored hashed. A desktop origin (below) passes the check only on a request without a `projo_session` cookie: bearer calls, sign-in with `token: true` and the pairing claim; a sign-in from it without `token: true`, `POST /setup` and `POST /invitations/:token/accept` are refused (`auth/origin_mismatch`), since they would open a cookie session: the desktop opens setup and invitations in the system browser.
- **Desktop origins** (`desktopOrigins` of `@projo/shared/api/desktop`: `http://tauri.localhost` and `tauri://localhost`, the desktop app's bundled UI on Windows and on macOS, §28): the only cross-origin callers. CORS on `/health` and `/api/v1/*`, the stream capability URLs `/api/v1/stream/*` included for `GET` and `HEAD` only (the bundled UI's html-video fallback when libmpv cannot load; they carry no ambient credential), and never on `/mcp`, `/oauth/*` or `/.well-known/*`; answered before authentication (a preflight `OPTIONS` → 204 without a credential); methods `GET, HEAD, POST, PUT, PATCH, DELETE`, request headers `authorization`, `content-type`, `x-profile-id`, `Access-Control-Max-Age`, `Vary: Origin`, `Access-Control-Expose-Headers: retry-after, content-disposition`; never `Access-Control-Allow-Credentials` (a bearer, never a cookie).
- Rate limiting: 10 login attempts per 15 min per IP and per username (the slot is taken before the password check; a success resets the username counter, not the IP one), 5 PIN checks per minute per profile, 20 invitation acceptances per hour per IP.
- `TRUST_PROXY=false` by default: the client IP and scheme come from the direct connection. Behind a reverse proxy, the host sets it to `true` and the README explains why.
- Admin file browser: read-only, folders only, refuses paths outside `/`, does not follow symbolic links outside the browsed folder.
- Streams and images: every media URL is tied to a playback session or to an item visible to the account; no guessable URL without auth. The media a platform player loads for a playback session (direct file, playlists, segments, subtitle renditions, sidecar subtitle tracks of §10.4) are **capability URLs**: `/stream/:sessionId/:secret/…` (a live session's too, §29.4), a random secret of 256 bits created with the session (only its hash stored), enough on its own (no cookie or bearer: AirPlay receivers, AVPlayer sub-requests and the desktop app's libmpv carry no credentials), valid while the session is active (60 s without heartbeat ends it), and only for that session's source. The web uses them too. The request logs replace the secret with `***`. Images, previews, trickplay and the overlay's `<track>` WebVTT stay authenticated by cookie or bearer. **Media key**: a capability of a bearer session for what a page loads without a header (`<img>`, `srcset`, CSS `url()`, a `<video>`): `?key=<sessionId>.<base64url HMAC-SHA256(secret, "media:" + sessionId)>`, the secret 256 random bits generated once in `settings` (`auth.media_key_secret`). Given only by `GET /auth/me` to a request authenticated by a bearer, accepted only on `GET` and `HEAD` of the media routes (`/images/*`, `/previews/*`, `/trickplay/*`, `/admin/tmdb/posters/*`, never a path with a dot segment or a percent-encoding; the profile is the session's last) when the request carries no other credential (a bearer or a cookie wins, the key is then ignored), ignored everywhere else; it looks the session up, so it dies with it (revocation, sign-out, expiry, disabled account). The request logs never write the query. The rest of a playback session (heartbeats, end) can only be used by its account, from a resolved active profile that is its own or that sees its item (`<video>`/HLS streams and `sendBeacon` without `X-Profile-Id` take the auth session's last profile, updated by `X-Profile-Id` and `POST /profiles/:id/select`).
- MCP server (§27): its credentials (assistant tokens, OAuth access tokens) are accepted on `/mcp` only and `/mcp` accepts nothing else; all hashed; admin role and unrestricted profile re-checked on every request; foreign `Origin` refused; 120 requests per minute per assistant. OAuth 2.1 with S256 PKCE, public clients, refresh tokens rotated with reuse detection, consent always shown by projo with the host the code goes back to, client metadata fetched over HTTPS only and never from a private address. Hosted clients (ChatGPT, Claude connectors) call from their cloud: `/mcp`, `/.well-known/*` and `/oauth/*` must be reachable from the internet (Anthropic: `160.79.104.0/21`).
- Desktop app (§28.4): its window shows only its bundled UI, the only page granted its IPC (libmpv, window, token), never a remote one; the server's `Content-Security-Policy` is not loosened for it. The bundled UI reaches the server from a desktop origin (above) with a bearer, kept in the Windows Credential Manager, and the media key.
- Image uploads: type checked by magic signature, max size 10 MB, re-encoded by ffmpeg before storage.
- Subprocesses: arguments passed as an array, never through a shell; file paths never interpreted.
- Updates: SHA-256 check of the archive and of each file through the manifest, download only from `github.com/LeoMartinDev/projo/releases`.
- Headers: strict `Content-Security-Policy` (no inline, no external domain), `X-Content-Type-Options`, `Referrer-Policy: same-origin` (no referrer leaves the origin; with `no-referrer`, WebKit sends `Origin: null` on `sendBeacon`), `Cross-Origin-Resource-Policy: same-origin` except on the answers of the media routes and stream capability URLs to a request without a session cookie (bearer, media key, capability): `cross-origin`, since the desktop's bundled UI loads them as `<img>` and `<video>`. A cookie request keeps `same-origin`, so a same-site sibling origin cannot embed artwork to probe what an account sees.
- Dependencies: `bun audit` in CI, pinned versions.

---

## 21. Non-functional

| Topic | Target |
|---|---|
| Library size | designed and tested for 20,000 items (generated fixtures) |
| Empty incremental scan | < 10 s on 5,000 files |
| First full scan | 5,000 files discovered, probed and classified in < 5 min excluding TMDB matching (parallel probing ×2) |
| Server startup | < 3 s before `/health` OK |
| Catalogue API | p95 < 100 ms for `/home`, each batch of `/home/categories`, each page of `/home/categories/:category`, `/movies`, `/search` on 20,000 items |
| Playback start | direct < 1 s; HLS remux < 3 s; HLS transcode < 5 s after the first segment |
| HLS seek | < 3 s |
| Server memory | < 300 MB excluding ffmpeg |
| Browsers | last two versions of Chrome, Edge, Firefox, Safari; iOS Safari; Android Chrome. No guarantee on TV browsers. |
| Mobile app | iOS and iPadOS 17 and later (§26). Android builds from the same code, without a guarantee. |
| Desktop app | Windows 10 and 11, x86_64, WebView2 (§28). macOS 11 or later, Apple silicon, WKWebView (§28.11). Linux untested. |
| Server platforms | Linux x86_64 and arm64, Docker. |
| Observability | structured JSON logs on stdout with `code`, `jobId`, `sessionId`, also kept 14 days for the admin's log viewer (§15); `/health`; counters in the admin dashboard. No outgoing telemetry. |
| Backup | all of `/data`; "Export the database" runs a `VACUUM INTO` into `db/backups/`. |

---

## 22. Tests and CI

- **Unit (`bun test`)**: `core` and `application` without infrastructure, with in-memory adapters. Mandatory coverage: name parser (each row of §8 = at least one case), classifier, stability detection (simulated clock and FS), matching scoring, TMDB genre mapping (§9.1), track cascade, "watched" rule and Continue watching, selection and order of the home categories (§13.3), HLS playlist computation from a keyframe index, segment chain, `Result` and error mapping.
- **Integration**: SQLite repositories on a temporary database; scanner on real fixture trees (`test/fixtures/libraries/*`) including tiny video files generated by ffmpeg (`testsrc`), a simulated "being written" file, a `Subs/`, a multi-episode, a `cd1`/`cd2`; real ffprobe and ffmpeg; TMDB and segment providers replaced by test HTTP servers with recorded responses.
- **E2E (Playwright)**: the five journeys of §4 on Chromium, then a WebKit smoke test (playback and resume of a MKV on desktop Safari, the journeys tagged `@mobile` on the iPhone viewport), one at a time against a single server started with a fixture library. What a background job produces without a screen of its own (timeline thumbnails, fingerprints) is covered by the integration tests.
- **Lint and types**: `bun lint` (layers, classes, `null`), strict `bun check`, `exactOptionalPropertyTypes`, `bun fmt`.
- **Mobile app** (§26.8): `bun test` on its logic kept in modules without React Native, lint and types like the web; no component tests, no mobile E2E.
- **Player** (§10.7): `@projo/player` is tested once for every engine: the reducer and the pure rules by unit tests, `createPlayerController` against the fake engine of `packages/player/src/testing/` (scripted `MediaEvent` sequences) and in-memory ports (`PlaybackApi`, manual `Timers` and `Clock`, `KeyValueStorage`): sessions and heartbeats, track, quality and version changes, in-place audio and subtitle changes, automatic skips, countdown and next episode, parts, error states. The engine contract suite (`engine-contract.ts`) runs against the fake engine and against `mpv-events.ts` fed with recorded libmpv property and event sequences (JSON fixtures beside `mpv-events.ts`, captured from the desktop app). The web's E2E covers the `html-video` engine.
- **Desktop app** (§28.8): the desktop host's logic has `bun test` unit tests, the Rust side `cargo test` ones (libmpv node → JSON conversion, server URL validation, device name, newest release tag); no automated test drives libmpv nor the window; manual checks before each desktop release.
- **GitHub Actions CI**: on every push and PR: lint, types, unit, integration, e2e. On a push to `main` whose `package.json` version has no release yet, once the above passed: bundle build, generation of the manifest and `SHA256SUMS`, `v<version>` tag and GitHub release with notes generated from the commits (Conventional Commits), build and push of the multi-arch runtime image if `runtime/` changed or if the tag is `runtime-*`. On a push to `main` whose `apps/desktop/package.json` version has no release yet: the desktop app's signed Windows installer on a `desktop-v<version>` release (§28.10).
- **Versioning**: semver, `main` the only long-lived branch, mandatory PRs, Conventional Commits.

---

## 23. Milestones

Each milestone ships on its own, tested, and ends with an "I use it at home" criterion checked by Léo on their own library. A milestone is not finished until its tests pass in CI.

### M1 — Foundation: I see my files and I play a movie

Deliverables:
- Monorepo, tooling, §5.3 lint rules, `Result` and error codes, base schema and migrations, logger, composition root, `/health`.
- Runtime image and supervisor (without updates), reference `docker compose`.
- First-launch wizard, login, cookie session, one admin account.
- Library CRUD with folder browser.
- Full scanner: discovery, filter, exclusions, extras, quarantine and stability, probe and sample decoding, `pending`/`ready`/`missing` states, root safeguard, watcher, periodic, manual, moves, `scan_runs`, progress SSE.
- Classification and parsing of the whole §8 table with fixtures (without TMDB matching: items are created with the parsed title).
- `direct` and `hls_remux` playback with keyframe index, sessions, heartbeat, progress and resume.
- Minimal web: login, Movies, Shows (grids without posters), minimal title page, player with the basic controls, i18n in place.
- Unit and integration tests of the scanner and the parser; reduced e2e of journey 1.

Criterion: *"I run projo in Docker at home, I add my messy folder, I see my files with clean titles, no file being downloaded shows up, and I play an MKV in Chrome and Safari, resuming where I left off."*

### M2 — Identity and household: my family uses the home page

Deliverables:
- TMDB matching, images, cast, external ids, corrections memory, "To review" queue with assignment.
- Complete movie and show pages, complete home page (hero, rows), FTS5 search, sorting and filters.
- Complete progress: Continue watching, next episode, watched / unwatched, bulk actions, My list.
- Accounts, invitations, profiles, per-profile library access and maximum rating, PIN, "Who's watching?" screen, profile settings, devices and revocation.
- Applying the `design/` design to all viewer screens.
- E2E of journeys 1, 2, 3, 5.

Criterion: *"My family has its accounts and profiles, the home page looks like the design, everyone resumes where they left off, and I fix a bad match in 30 seconds."*

### M3 — Complete playback: everything plays, with the right tracks

Deliverables:
- `hls_transcode`, qualities, transcode limit, downmix, cache and cleanup.
- Subtitles: external and embedded as WebVTT, bitmap burn-in, delay and size.
- Audio and subtitle cascade (§11), per-show memory, toast.
- Multiple versions and picker, chained parts, multi-episodes.
- Trickplay and hero video preview.
- Complete player: shortcuts, mobile, speed, PiP, chapters, error states.
- Active sessions in the admin with stopping.

Criterion: *"Every file of my library plays in Chrome, Firefox, Safari and on iPhone, with the audio and subtitles I expect without touching anything, and I see thumbnails when hovering the bar."*

### M4 — Intros and credits: I binge without a remote

Deliverables:
- Segment model, `SegmentProvider` port, TheIntroDB, IntroDB, SkipDB adapters, lookup cache, chapters.
- Per-season Chromaprint fingerprinting.
- Manual markers with "Apply to the whole season".
- Player: skip intro, skip credits, countdown, "watched" rule through `credits`, profile toggles.
- Opt-in contribution of manual markers.
- E2E of journey 4.

Criterion: *"I watch three episodes in a row without touching anything: the intro is skipped, the next one follows, and on a French show missing from the databases, fingerprinting found the intro."*

### M5 — Operations: I update from the admin

Deliverables:
- Updates: `check_updates`, `apply_update`, supervisor with switch, health check, automatic and manual rollback, database backup, `runtimeMin`.
- Telling a clean shutdown from a crash on restart: today a `running` job on its last attempt is set to `failed` on startup even after a clean SIGTERM, which would make an `apply_update` interrupted by the switch fail.
- Complete admin: dashboard, pending files, missing files and purge, jobs, notifications, playback, intros and credits, metadata and server settings, database export.
- Metadata editing with locks and alternative or uploaded images, manual and weekly refresh.
- Release pipeline in CI, first public release `v1.0.0`.
- Final README documentation.

Criterion: *"I update projo from the admin and roll back in one click, I know why a file does not show up without opening a terminal, and a stranger can install projo with the README alone."*

### M6 — Mobile app: my family watches from the iPhone and the iPad

Vertical slices, each usable end to end, in this order (§26):
1. **Foundation**: `packages/i18n` extracted from the web, `apps/mobile` (Expo, Expo Router, lint, TanStack Query, `hc<AppType>`); server: `POST /auth/login` with `token: true`, pairing (`/auth/pairings`, web "Connect a device" dialog and `/pair` page), the §17.1 compatibility rule and the app's server version check. I connect the app and pick a profile.
2. **Profiles and account**: "Who's watching?" and PIN, the active profile's settings (§11.1, §12.4, interface language, name, colour), profile management, devices and sign-out. These settings are the server's, so what the app changes holds on the web too; any server change they need lands in the web in the same slice. The design of the app's entry screens (server connection, sign-in, "Scan a code", code entry, "Who's watching?") and Geist throughout the app (§26.5).
3. **Browsing**: home, Shows, Movies, My list, category pages, search, title pages, long-press actions, iPhone and iPad layouts.
4. **Player prototype** (dev build) and the decision of §26.6. Done: home-made chrome on `expo-video`.
5. **Playback**: capability URLs (§20), subtitles inside HLS and their delay (§10.4), the player, resume and heartbeat, intros and credits, next episode, quality by network, SSE during playback.

The spec of each slice is completed here before its code.

Criterion: *"I pair my iPhone by scanning a code, pick my profile, and binge a show on the iPad: the intro is skipped, the next episode follows, even in Picture-in-Picture or on the TV over AirPlay, with my subtitles."*

### M7 — Assistant: I clear "To review" from Claude

Vertical slices (§27):
1. **Connection**: assistant tokens and the "AI assistants" table in Admin → Server; `POST /mcp` (stateless Streamable HTTP, `Origin` check, rate limit) with the read tools; OAuth 2.1 (discovery, DCR, CIMD, consent page, tokens with rotation). I connect Claude Code with a token and ChatGPT with OAuth, and both list my files to review.
2. **Actions**: the check and write phases of the assignment and rematch use cases, then `assign_source` and `rematch_item` with `dryRun`; `hide_source` and `restore_source`.

Criterion: *"I paste one command into Claude Code, ask it to sort my files to review, check its preview, and the files show up in projo with the right titles."*

### M8 — Live TV: I zap through my channels in projo

Vertical slices (§29), each usable end to end:
1. **Channels**: TV sources of kind `m3u` (refresh, groups and channels to enable, connection limit), Admin → TV, the relay's `copy` rendition, live sessions, the player's live mode, the TV page without guide. Web and desktop.
2. **Every channel on the web**: the probe and the `compat` rendition (interlaced video, codecs the browser does not decode).
3. **Guide and favourites**: XMLTV, now and next on the page and in the player, favourites, the per-profile access switch.
4. **Freebox**: the `freebox` kind (channels, logos and guide from the box's API).
5. **Xtream Codes**: the `xtream` kind, its connection limit read from the account.

The spec of each slice is completed in §29 before its code.

Criterion: *"I add my box and a playlist, tick the channels I want, and from the web or the desktop app I zap between them and see what is on now and next, without any of it leaving my server's address."*

---

## 24. Default decisions

Decisions taken to move forward, changeable without breaking the model. Values are admin settings unless stated otherwise.

| Decision | Value |
|---|---|
| Quiet period before probing | 120 s |
| Periodic scan interval | 15 min |
| "Pending since" alert | 24 h |
| Purge of missing files | 30 days |
| Simultaneous transcodes | 2 |
| Hardware transcoding | off (VAAPI as an option) |
| Transcoding cache | 10 GB, LRU |
| Grace after end of session | 5 min |
| Session without heartbeat | 60 s |
| Heartbeat | 10 s |
| "Watched" | 93 % or `credits` |
| "Resume" | 2 % to 93 % |
| Continue watching | 20 items |
| Home categories | 6 visible titles minimum, 12 rows max, 20 titles per row, batches of 4 rows (fixed) |
| Profiles per account | 5 (fixed) |
| Avatars | initial on a coloured tile, six colours, no upload (fixed) |
| Hero video preview | 20 s from 25 %, 720p, muted by default, desktop only (and the iPad app on Wi-Fi, §26.5) |
| Invitation | single use, 7 days |
| Pairing code | 6 characters, single use, 5 min, 3 live per account (fixed) |
| App quality (per device) | Original on Wi-Fi, 720p on cellular, changeable by the user |
| Session | 30 sliding days |
| MCP assistants (§27.3) | until revoked; 120 requests per minute; OAuth code 60 s, access token 1 h, refresh token 90 days rotated (fixed) |
| TMDB image sizes | poster w500, backdrop w1280, logo w500, still w300, person w185 |
| HLS segments | 4 s in transcode, 3 to 8 s in remux |
| Qualities | Original, 1080p 8 Mb/s, 720p 4 Mb/s, 480p 1.5 Mb/s |
| Live TV (§29) | source refresh daily, guide every 6 h over the next 24 h, HLS segments about 2 s over a 30 s window, stream stopped 30 s after its last viewer, missing channel deleted after 7 days |
| Multichannel audio | stereo downmix |
| Trickplay | 1 image / 10 s, 320 px, 10×10 sprites |
| Fingerprinting | first 10 min, last 5 min, intro 15 to 150 s, 2 corroborating episodes |
| Segment providers | TheIntroDB, IntroDB, SkipDB, in this order, all enabled |
| Contribution | off |
| Metadata language | fr-FR, en-US fallback |
| Environment variables | `PORT`, `DATA_DIR`, `TRUST_PROXY`, `LOG_LEVEL` (fixed) |
| Data folder | `/data`, §5.4 layout (fixed) |
| Licence | AGPL-3.0-only |
| Docker image | `ghcr.io/leomartindev/projo` |

---

## 25. References

- TMDB API: https://developer.themoviedb.org/docs
- Jellyfin, movie naming: https://jellyfin.org/docs/general/server/media/movies
- Jellyfin, show naming: https://jellyfin.org/docs/general/server/media/shows
- Jellyfin, ids in names: https://jellyfin.org/docs/general/server/metadata/identifiers
- Jellyfin, parsing rules (reference regexes): https://github.com/jellyfin/jellyfin/blob/master/Emby.Naming/Common/NamingOptions.cs
- Infuse, Metadata 101: https://support.firecore.com/hc/en-us/articles/215090947-Metadata-101
- Infuse, subtitles: https://support.firecore.com/hc/en-us/articles/215090967-Using-Subtitles
- TheIntroDB: https://theintrodb.org/docs , OpenAPI https://theintrodb.org/openapi.yaml , terms https://theintrodb.org/docs/terms
- IntroDB: https://introdb.app/docs , OpenAPI https://api.introdb.app/openapi.json , terms https://introdb.app/docs/terms
- SkipDB: https://skipdb.tv/docs , code https://github.com/SkipDB-TV/skipdb , licence https://skipdb.tv/license
- Intro Skipper (Jellyfin, fingerprinting method): https://github.com/intro-skipper/intro-skipper
- Chromaprint / fpcalc: https://acoustid.org/chromaprint
- hls.js: https://github.com/video-dev/hls.js
- AVKit `contextualActions`, tvOS and visionOS only, unavailable on iOS (why the app has its own chrome, §26.6): https://developer.apple.com/documentation/avkit/avplayerviewcontroller/contextualactions
- HLS authoring for Apple devices (subtitle renditions, `X-TIMESTAMP-MAP`): https://developer.apple.com/documentation/http-live-streaming/hls-authoring-specification-for-apple-devices
- Claude Code, MCP servers over HTTP with headers: https://code.claude.com/docs/en/mcp
- MCP authorization: https://modelcontextprotocol.io/specification/latest/basic/authorization
- Claude, authentication for connectors (CIMD, DCR, callback URLs, 401 discovery, token endpoint, egress range): https://claude.com/docs/connectors/building/authentication

---

## 26. Mobile app (iOS, iPadOS)

### 26.1 Goal and scope

A native app for iPhone and iPad, on the same server and API as the web. The PWA stays. What the app brings over the web on iOS: the system player integration (reliable Picture-in-Picture, playback in the background and with the screen locked, AirPlay, rotation, Now Playing), native navigation and gestures, and later a presence on the App Store.

- **Targets**: iPhone and iPad, iOS and iPadOS 17 and later. Android builds from the same Expo code without dedicated work nor guarantee.
- **Viewer only**: sign-in and pairing, "Who's watching?" and PIN, profile settings and management, home, Shows, Movies, My list, category pages, search, title pages, player, account and devices. For an admin, an "Administration" entry opens `<server>/admin` in the system browser; no admin screen in the app, no invitation.
- **Out of scope**: offline playback and downloads, several servers, push notifications, Chromecast, an embedded admin (§2.3 unchanged otherwise).

### 26.2 Stack, repository, distribution

- Expo on the latest SDK (the one Expo Go supports), Expo Router, TanStack Query with `hc<AppType>`, `expo-video`, `expo-image`, `expo-secure-store`, `expo-camera`.
- `apps/mobile/src/{app,features/<feature>,shared/{api,i18n,styles}}`, the web's layout. The §5.3 rules apply as on the web (no class, no `null`, `Result`, `bun lint`). Native code (Swift, Expo Modules) only in `apps/mobile/modules/`, the only exception.
- Shared with the web: `@projo/shared` (schemas, `Result`, error codes), the `AppType` type, and `packages/i18n`: the `fr`/`en` strings and the pure label helpers (genres, versions, editions, item titles, content ratings, errors), moved out of `apps/web/src/shared/i18n`. No shared UI component.
- Development and iOS builds on macOS with Xcode. Distribution in phases: (1) Expo Go; (2) a dev build signed with a free Apple ID (Personal Team, re-signed every 7 days) for what Expo Go cannot load: the player prototype (§26.6) and any module of `modules/`; (3) TestFlight, household as internal testers (members of the App Store Connect team, no beta review); (4) the App Store, with a public read-only demo server playing open films (Blender) for Apple's review, set up only for the submission.
- Identity: name "projo", bundle id `dev.leomartin.projo`, its own semver from 1.0.0, independent of the server's.

### 26.3 Server connection and sign-in

- One server URL, the one that works at home and outside (reverse proxy, §20 `TRUST_PROXY`). Plain HTTP is accepted (App Transport Security exception and local network usage description in the dev and store builds).
- Two ways in: **pairing** (§14: scan the QR code shown by the web from the app's "Scan a code" screen, or type the server URL and the code; `projo://` links come with the dev build) or **sign-in** with username and password (`POST /auth/login` with `token: true` and the device name).
- The device name (`deviceName` of the claim and of the sign-in) is the model: "iPhone 15 Pro", "iPad Air". Since iOS 16 an app cannot read the name the user gave the device without an entitlement Apple rarely grants; two identical models are told apart by their last activity. No renaming in M6.
- The bearer token is kept in the Keychain (`expo-secure-store`); a 401 sends back to the sign-in screen, server URL kept. Then "Who's watching?" by the rules of §13.6, the app install being the device.
- PIN only, never Face ID or Touch ID: a family iPad is enrolled with a parent's face, biometrics would not tell who holds it.

### 26.4 Compatibility with the server

- The server keeps `/api/v1` additive (§17.1).
- The app declares the minimum server version it needs, a constant raised whenever it starts relying on something a server release added: 1.5.0 from slice 1 of M6 (sign-in with `token: true`, pairing), 1.6.0 from slice 3 ("Continue watching" stills, `resumeFrame.url`). It reads `GET /health` at launch and when it comes back to the foreground; an older server shows a blocking "Update your projo server" screen (an admin is told it is done from the web administration).
- Responses are parsed without rejecting unknown fields.

### 26.5 Screens and navigation

- Identity of the web (§19: dark, Geist, tokens, image formats), idioms of iOS: native stack transitions and back swipe, sheets. Geist and Geist Mono are bundled with the app (`expo-font`) and used on every screen.
- **Entry screens** (server connection, sign-in, "Scan a code", code entry, "Who's watching?") have no artboard of their own: they take the language of the onboarding artboards and of the web's sign-in page (`OnbWelcome`, `OnbAccount`: a full-screen illustration with a slow Ken Burns, still under reduced motion, a glass panel, the fields and buttons of the UI kit v2), with the web's illustrations (`packages/design/backdrops/`) bundled in the app, and "Who's watching?" that of `Main.dc.html` (initial on a coloured tile, PIN padlock).
- iPhone: tab bar Home · Shows · Movies · My list · Search, avatar at the top (as `MobileHome`). iPad: a sidebar with the same entries, in the manner of the Apple TV app, with a layout of its own rather than an enlarged iPhone.
- Browsing (slice 3) has no artboard beyond `MobileHome` and `MobileSeries`: the iPad sidebar is the system's sidebar-adaptable tab bar; on an iPad (a content width of 600 pt or more) the hero and the title pages take the landscape composition of `Home` and `Series`, cards are larger and grids have more columns. Movies and Shows put the sort above the grid and the filters in a sheet behind the header's button; search is the system search tab. On an iPhone the hero card opens the title page (no "More info" button, as `MobileHome`). Until playback (slice 5), "Play" and "Resume" are shown but inert, and the actions that play ("From the beginning") are left out.
- A long press on a card opens a native sheet with the §13.3 card actions (grid tiles included).
- Home hero: a fixed backdrop on iPhone; the video preview (§13.3) only on iPad and on Wi-Fi.
- Profile settings and management, account and devices: same content and same restrictions as the web (§13.6, §14). Device settings of the app: server, quality on Wi-Fi and on cellular, about, sign out.
- States of §19 (empty, loading, error translated from the code, offline banner).
- No SSE outside the player: queries are refetched when the app returns to the foreground.

### 26.6 Playback

- **Engine**: AVPlayer through `expo-video`. The client declares `hls: native`, the codecs the device decodes and `subtitleDelivery: hls` (§10.2, §10.4), `engine` absent (`browser`). MKV and the codecs AVPlayer does not read go through `hls_remux` or `hls_transcode` as on Safari. An advanced engine reading MKV, DTS, TrueHD and ASS directly (libmpv or VLCKit, declared as the desktop app's is, through the `engine` capability of §10.2) stays a later option, not M6.
- **One playback logic with the web**: the app's player is driven by `@projo/player` (§10.7) through an `expo-video` engine (a `PlayerEngine` adapter in `apps/mobile/src/features/player/`, passing the contract suite of §22), with the app's own React Native interface on its controller: sessions, heartbeats, track and quality changes, §12.4 skips, next episode and parts are the web's code, not a second implementation. Planned with the playback slice; the package already keeps to Hermes (§5.3).
- **Streams**: the session's capability URLs (§20), which AirPlay receivers can fetch.
- **Subtitles**: inside the HLS stream (§10.4), so they show in Picture-in-Picture and over AirPlay; delay through the server, size through the iOS accessibility settings.
- **Quality**: a per-device setting for Wi-Fi (default Original) and for cellular (default 720p), changeable by the user, sent as `quality` when the session starts.
- **One playback logic, whatever is shown**: the §12.4 rules (auto skip of intro and recap, `credits` countdown, `autoplay_next`, `auto_skip_credits`, "watched") run the same whether the controls are visible, in Picture-in-Picture, over AirPlay or with the screen locked; the next episode loads into the same player, which keeps Picture-in-Picture and AirPlay.
- **Orientation**: landscape forced on iPhone (both sides), free on iPad.
- Heartbeat (§10.6) every 10 s, on pause, seek and track change, and when the app goes to the background. Playback continues in the background. SSE only while the player is open, for `playback.session_terminated`.
- **Player interface: a home-made chrome on top of `expo-video`**, matching §10.7 and the player artboards (`Player`, `PlayerNext`, the player menus, `MobilePlayerLanguages`). Decided by the M6 prototype (a dev build presenting `AVPlayerViewController` from an Expo module on a real projo HLS session with a subtitle rendition): `AVPlayerViewController.contextualActions`, the only way to show "Skip intro" and "Next episode" in the native player, exists on tvOS and visionOS only (`API_UNAVAILABLE(ios)` in the iOS SDK), and the native player has no other control over its own. The prototype confirmed on AVPlayer, so for `expo-video` too: a projo HLS session plays, a WebVTT rendition shows on time and follows into Picture-in-Picture. No control can be shown in Picture-in-Picture or over AirPlay with any player: the §12.4 automatic skips and the `credits` countdown run from the app's time observer. To check on a real device in slice 5: subtitles over AirPlay, playback in the background and with the screen locked. Written here before slice 5: the skip button on touch, the "Next episode" screen, gestures and seeking, Now Playing commands, changing quality or version during playback, turning subtitles on from a `direct` session.

### 26.7 Server changes brought by the app

Pairing and sign-in returning a token (§14, §6.1 `pairings`, §17.2), the compatibility rule (§17.1), capability URLs for every session media (§20, §6.4, §17.2, the web included), the `subtitleDelivery` capability and subtitles inside HLS with their delay (§10.2, §10.4). The web gains the "Connect a device" dialog and the `/pair` page.

### 26.8 Tests

The app's logic (quality choice, version check, parsing of the pairing QR code; the playback logic is `@projo/player`'s, tested there, §22) lives in modules without React Native, tested with `bun test`. No component tests, no mobile E2E. Server changes follow §22 as usual.

---

## 27. MCP server

### 27.1 Goal and scope

The admin works the "To review" queue (§7.8) and fixes matches ("Fix the match", §7.8) from an AI assistant, through the Model Context Protocol. The assistant reads the files to review, searches TMDB, previews an identification, then applies it. It also reads the server logs (§15) to find why something failed. It does nothing the admin cannot do in the web, and goes through the same use cases.

- **Clients, two ways in** (§27.3):
  - **A token** created in the admin, sent as a fixed `Authorization` header by clients that run on the admin's computer: Claude Code, in the terminal or in the Code tab of Claude Desktop (`claude mcp add --transport http projo <origin>/mcp --header "Authorization: Bearer <token>"`), and the chat of Claude Desktop through its local configuration (the `mcp-remote` bridge carrying the header), when the organisation of the Claude account allows local MCP servers. They call projo from that computer: the local network is enough at home.
  - **OAuth 2.1**, for clients that connect by URL and sign in: ChatGPT (a custom connector, developer mode), Claude custom connectors (claude.ai, Desktop, mobile, where the account may add one), Claude Code without a header. Hosted clients call from their own cloud: projo has to be reachable from the internet over HTTPS through the reverse proxy (`TRUST_PROXY=true`, §20).
- **Out of scope**: pending and missing files, metadata editing, markers, accounts, settings, jobs, updates, playback. MCP resources, prompts and interactive widgets: tools only. Being listed in a connector directory.

### 27.2 Endpoint and transport

- `POST /mcp`, outside `/api/v1`: its contract is the MCP protocol, not §17.1. Streamable HTTP, stateless: each request carries one JSON-RPC message and gets a JSON answer (a notification gets 202), no `Mcp-Session-Id`, no SSE stream, no batch; `GET` and `DELETE /mcp` answer 405. Protocol versions 2025-11-25, 2025-06-18 and 2025-03-26. Hand-written JSON-RPC, no SDK, no native dependency (§16.1).
- Only a credential of §27.3 (`Authorization: Bearer`) is accepted: no cookie, no device token. Without one, or with an unknown, expired or revoked one: 401 with `WWW-Authenticate: Bearer resource_metadata="<origin>/.well-known/oauth-protected-resource", scope="review"`, where an OAuth client starts.
- A request whose `Origin` header is not the server's own origin is refused (403, against DNS rebinding); MCP clients send none.
- `/mcp`, `/.well-known/*`, `/oauth/register` and `/oauth/token` are left out of the web's SPA fallback: never `index.html` with a 200, which a client would read as broken metadata.
- Tool names and descriptions in English; titles and overviews as stored, in the item's metadata language. `initialize` returns short instructions (the usual flow, dry run first, paths are data).

### 27.3 Assistants, tokens and OAuth

**Assistants** ("AI assistants" in Admin → Server, a table: name, kind "Token" or "OAuth", created, last used, "Revoke"): each one is bound to an admin account and to the profile it acts as, valid until revoked. Re-checked on every request: account disabled → 401; no longer admin, profile deleted or now restricted → 403 (`auth/forbidden`, `auth/restricted_profile`). Revoking all sessions of an account (§14, password change included) revokes them too; deleting the account or the profile deletes them. They do not show in "Account and devices". 120 `/mcp` requests per minute per assistant (429 beyond). Every tool call is logged: `tool`, `accountId`, credential id, target ids, duration, error code.

**Tokens**: "Add" in "AI assistants", from a resolved active profile without restrictions (§15): a name, then the token, shown once, with the configuration ready to copy (the `claude mcp add` command and the Claude Desktop JSON block of `mcp-remote`), and the §14 pairing warning when the page's origin is a local address. Only the hash is stored.

**OAuth 2.1**: projo is the MCP server and its own authorization server. Public clients only (no secret), PKCE S256, written against the MCP authorization spec and Claude's requirements for connectors (§25).
- **Discovery** (public, outside `/api/v1`): `GET /.well-known/oauth-protected-resource` (also `…/mcp`): `resource` = `<origin>/mcp`, `authorization_servers` = `[<origin>]`, `scopes_supported` = `["review", "offline_access"]`. `GET /.well-known/oauth-authorization-server` (also `/.well-known/openid-configuration`): `issuer` = `<origin>`, `authorization_endpoint` `<origin>/oauth/authorize`, `token_endpoint` `<origin>/oauth/token`, `registration_endpoint` `<origin>/oauth/register`, `response_types_supported: ["code"]`, `grant_types_supported: ["authorization_code", "refresh_token"]`, `code_challenge_methods_supported: ["S256"]`, `token_endpoint_auth_methods_supported: ["none"]`, `client_id_metadata_document_supported: true`. `<origin>` is the request's (scheme and host through `TRUST_PROXY`).
- **Clients**: a `client_id` that is a URL is a **Client ID Metadata Document**, read over HTTPS only (no redirect, 5 s, 64 KB, refused when its host resolves to a loopback, private or link-local address), whose `client_id` must equal its URL, kept a day. Otherwise it comes from **Dynamic Client Registration** (`POST /oauth/register`, RFC 7591, 10 per hour per IP); a registration unused for 30 days and without a live assistant is deleted. Redirect URIs: HTTPS, or a loopback (`http://localhost/…`, `http://127.0.0.1/…`, `http://[::1]/…`) matched without its port (RFC 8252, Claude Code).
- **Consent**: `/oauth/authorize` is a page of the web app. Not signed in: the sign-in page, then back; a profile to choose: "Who's watching?", then back. The page asks `GET /api/v1/oauth/authorize` with the query and shows the client's name, the host it sends the code back to, a warning when that is a loopback (an app on this computer gets the access), and the profile it will act as: **the active profile**. "Allow" and "Cancel" post to `POST /api/v1/oauth/authorize`, which answers where to go (`code` and `state`, or `error=access_denied`). An unknown client, a redirect URI not among the client's, no PKCE S256, `response_type` other than `code` or a `resource` other than `<origin>/mcp`: the page shows the error and never redirects. Not an admin, or a restricted active profile: the page says only an administrator can connect an assistant, and "Back" sends `access_denied`.
- **Tokens**: `POST /oauth/token`, `application/x-www-form-urlencoded`, RFC 6749 errors (`invalid_grant`, `invalid_request`, `unsupported_grant_type`), `Cache-Control: no-store`, 20 failed requests per 15 min per IP. `authorization_code`: the code (single use, spent by any attempt, 60 s), its `code_verifier`, `redirect_uri` and `client_id` → a new assistant (`kind = oauth`, named after the client) and its tokens. Access token 1 h, refresh token 90 days, rotated on every use; a refresh token presented again after its rotation revokes the assistant. Codes and tokens: random 256 bits, only their hash stored; expired ones deleted daily.

### 27.4 Tools

| Tool | Kind | Content |
|---|---|---|
| `review_summary` | read | Files to review by reason and by library; totals of pending, missing and hidden files. |
| `list_review_queue` | read | The "To review" list by series group (§7.8, `ready` files), filters `libraryId?` and `reason?` (a group keeps its files of that reason), `cursor` and `limit` of groups (50 by default, 200 max), `total` files: per group its number of files, show name, show folder, reasons with their counts, and its first file: source id, library, path relative to its root, reason, what the parser understood (kind, title, year, season, episode), version, duration, size. |
| `get_review_source` | read | One file to review with the same fields, the local item it sits under, the files of its series group (§7.8: those `assign_source` takes along and `hide_source` with `wholeGroup` hides) and the other files to review of its folder. |
| `search_tmdb` | read | `GET /admin/tmdb/search` (§17.2): `query`, `kind` (`movie` \| `series`), `year?`, `language?` → `tmdbId`, title, original title, year, overview, popularity. No poster. |
| `get_tmdb_series` | read | A TMDB show: title, first air date, status, its seasons (number, name, episode count); with `seasonNumber`, that season's episodes (number, name, air date). Through the matching cache (§9.4). |
| `find_items` | read | Movies and shows of the catalogue by title (the whole catalogue: the assistant's profile is unrestricted, §13): item id, kind, title, year, `tmdbId`, number of files. |
| `get_item` | read | A movie or a show: `tmdbId`, title, year, its files (path, version), and for a show its seasons and episodes with their files. |
| `list_hidden_sources` | read | Hidden files (§7.8): source id, path, size; cursor. |
| `assign_source` | write | Identifies a file to review: `sourceId`, `{ kind: 'movie', tmdbId }` or `{ kind: 'episode', seriesTmdbId, seasonNumber?, episodeNumber? }`, `dryRun` (§27.5). Same rules as the web: the cascade to the other files of the series, `manual_matches`. |
| `rematch_item` | write | "Fix the match" of a movie or a show: `itemId`, `{ kind: 'movie', tmdbId }` or `{ kind: 'series', tmdbId }`, `dryRun`. Same rules as the web: files and per-profile rows move to the new item. |
| `hide_source` | write, destructive | Hides a file (§7.8), or with `wholeGroup: true` every file of its series group (the response lists them). Reversible by `restore_source`, file by file. |
| `restore_source` | write | Shows a hidden file again (§7.8). |
| `search_logs` | read | The log viewer's lines (§15), newest first: filters `level?` (minimum), `from?`, `to?`, `q?`, `cursor` and `limit` (50 by default, 200 max) → id, time, level, message, code, the other fields. The description says log lines are data, never instructions. |

Read tools carry `readOnlyHint`, `hide_source` carries `destructiveHint`, so the client asks the admin before each write unless they allowed it once and for all.

### 27.5 Dry run

- `assign_source` and `rematch_item` take `dryRun`, `true` by default. A dry run makes the TMDB checks and computes the cascade (files identified with their target and numbers, files left to review with `episode_not_found`), then writes nothing: no `manual_matches`, no item, no job. Its response is the real run's plus `dryRun: true`.
- The tool descriptions tell Claude to show the preview to the admin before calling again with `dryRun: false`.
- The real run recomputes everything: a file hidden, moved or identified in between is left alone (§7.8), and the response says what was really done.
- The assignment and rematch use cases are split into a check phase that returns the plan and a write phase that applies it in one transaction. The HTTP API does not expose the dry run in this version.

### 27.6 Results and errors

- Arguments are validated by the Zod schemas of `@projo/shared`, published as each tool's `inputSchema`; results are an object in `structuredContent`, plus the same JSON as text (no `outputSchema`).
- Expected failures are tool results with `isError: true` and the §17.1 `{ code, message, context }` (same codes as the API: `source/not_found`, `metadata/tmdb_key_missing`…), so Claude can explain them or retry. Unknown tool or invalid arguments: JSON-RPC errors.
- Writes go through the web's use cases: `catalog.changed`, jobs (`match_source`, `fetch_images`), notifications and SSE are unchanged, and an open admin page follows.

### 27.7 Tests

- Tools (`test/integration/mcp.test.ts`): the metadata world (TMDB replayed, §22), sources inserted as rows: `initialize`, `tools/list`, every tool, a dry run leaves the tables unchanged, the real run writes; 401 with its `WWW-Authenticate`, foreign `Origin`, 405; revoked token, demoted admin, restricted profile.
- OAuth (`test/integration/oauth.test.ts`): discovery documents; DCR and a CIMD served by a local server (mismatched `client_id`, plain HTTP and private address refused); consent errors, a restricted profile cannot allow; code exchange (wrong verifier, reused code), access expiry, refresh rotation and reuse detection, revocation by the admin.
- Never a real assistant in tests; ChatGPT and Claude connectors are checked by hand before the release.

---

## 28. Desktop app (Windows, macOS)

### 28.1 Goal and scope

The household's computers play every file as it is: no remux, no transcode, no burn-in at original quality, HDR10 and Dolby Vision kept, DTS and TrueHD decoded on the computer, PGS and ASS drawn with their styling. The app **bundles its own UI**: the web app (`@projo/web-app`, §5.2) built into the app and served from the app's own origin (`http://tauri.localhost`), mounted with the desktop host, talking to the user's projo server as an API client with a bearer token, like the mobile app (§26), and playing through libmpv drawn under the page (§10.7). A throwaway prototype proved the playback approach on Windows 11 (HTML chrome over the native picture, hardware HEVC 10-bit HDR10, Dolby Vision and AV1 decoding, PGS, DTS-HD MA, resize, full screen, HTTP `Range` and seeking; `backdrop-filter` cannot see the picture); a second one proved the bundled page reaching a server cross-origin from WebView2 (CORS, bearer, `fetch`-streamed events, `<img>` with `Cross-Origin-Resource-Policy: cross-origin`, `keepalive` fetch).

- **Targets**: Windows 10 and 11, x86_64; macOS 11 or later on Apple silicon, with the differences of §28.11; both released and self-updating. Linux is later work, untested.
- **Everything the web does**, viewer and admin alike, but what opens in the system browser on the server's origin: the setup of a fresh server (§3), accepting an invitation, OAuth consent (§27), and §28.9.
- **Its UI updates with the app** (§28.10), not with the server: a server update never changes the app's screens. The app refuses a server older than its minimum (server 1.28.0, §28.3), never a newer one: the API is additive (§17).
- **Transitional, desktop apps older than 0.5.0** (they load the server's page in their window): the browser host (`apps/web`) detects Tauri and loads a separate chunk (`src/desktop-compat/`) giving back the window buttons, the desktop update banner ("Restart", after the server's own "Reload") and the desktop version in About; playback goes through `html-video` against the page's origin, never libmpv. The browser's entry chunk carries none of it. Their sessions still read "projo desktop" through the `projo-desktop/<version>` token their WebView2 appends to its user agent (the transitional row of `apps/server/src/core/auth/user-agent.ts`). Both are removed together once desktop apps older than 0.5.0 are gone.

### 28.2 Stack, repository, distribution

- Tauri 2 (Rust, WebView2). `apps/desktop`: workspace `@projo/desktop` (private), scripts `dev` and `build` (Tauri CLI, each building the UI first), `build:web` (the UI alone) and `fetch-libmpv` (§28.5); `src-tauri/` holds the Rust app, `web/` the bundled UI: a Vite app (React) mounting `@projo/web-app` with the desktop host (`web/src/desktop-host.ts`) after the screens of §28.3 (`web/src/Entry.tsx`), drawn with the sign-in page's frame (`EntryFrame` of `@projo/web-app/desktop/`: `@projo/design`, the `ocean` backdrop), strings from `@projo/i18n` (`login.*`, `mobile.*`, `desktop.*`). Built into `web/dist`, Tauri's `frontendDist`. No dev server, `tauri dev` included: the page must be on the origin the server's CORS allows. The §5.3 rules apply to its TypeScript (no class, no `null`, `Result`, the React lint of the web). Rust: a `Result` for every expected failure, never a panic across the FFI nor out of a command.
- Identity: name "projo", identifier `dev.leomartin.projo.desktop`, its own semver from 0.1.0 (`version` of `apps/desktop/package.json`, which `tauri.conf.json` reads; `Cargo.toml`'s is unused), independent of the server's.
- Distribution: `bun run --cwd apps/desktop build` gives the release executable and the Tauri bundler's Windows installer (NSIS, current user), or on macOS the app and its disk image (§28.11), the UI and libmpv included. CI publishes it on the repository's GitHub releases and the app updates itself from them (§28.10). No Authenticode signature: Windows SmartScreen warns on the first install.

### 28.3 Server connection

The window always shows the bundled page. Before the app, its screens (each in the system's language, the window buttons drawn):

- **Server address** (first launch, "Change server"): the server URL (`http://` or `https://`, a host and an optional port; any path is dropped, the origin is kept) and "Connect". The app checks from Rust (`check_server`: no CORS, so a server too old for the bundled UI still tells its version) that `GET <origin>/health` answers projo's health document within 6 s, otherwise the screen says why (not a valid address, unreachable, not a projo server). A redirect is followed once, only from `http://` to `https://` on the same host and port (an address typed without a scheme is `http://`), and the origin that answered is the one kept. Only a server ready for the app (recent enough, set up) is saved, as `serverUrl` in `config.json` of the app's config directory (`%APPDATA%\dev.leomartin.projo.desktop\`, `save_server`): a refused server never replaces the saved one. Moving to another origin forgets the previous one's token.
- **Server too old**: `/health`'s version below `minimumServerVersion` (`projo.minimumServerVersion` of `apps/desktop/package.json`, read by `web/src/server-version.ts` and by CI, §28.10; 1.28.0: the first server answering the macOS origin (1.25.0 was the first serving the bundled UI); a pre-release of it is older; raised when the UI relies on a newer server): "Update your projo server" with both versions, "Check again" and "Change server".
- **Setup in the browser**: `GET /api/v1/setup/status` (over CORS) says the server is not set up: "Finish setting up the server", which opens `<origin>/setup` in the system browser, "Check again" and "Change server". The app never runs setup (the server refuses it from a desktop origin, §20).
- **Unreachable**: at a later launch the saved server does not answer: its address, "Retry" and "Change server". An unreachable server is a state of the page, never WebView2's error page; once the app runs, a server that goes away shows the app's own network errors.
- **Then the app**: `@projo/web-app` mounted with the desktop host on the saved origin, at the page's path (a reload keeps the route). Without a kept token, the app's sign-in page: username and password (`POST /auth/login` with `token: true` and `deviceName`), or "Sign in with a code": a pairing code from "Connect a device" on another signed-in device (§14, `POST /auth/pairings/claim` with `deviceName`). Profiles and PIN are the web's.
- **The token**: kept by the app in the Windows Credential Manager (the `keyring` crate's native backend: a generic credential, service `dev.leomartin.projo.desktop`, user the server origin), never in the page's storage; the page gets it at start (`get_token`) and holds it in memory for its requests. Sign-in and a claimed code keep it (`set_token`), sign-out and a 401 forget it (`clear_token`). A credential store that fails is an error of the command, never a crash: the session then lasts until the app quits.
- **Device name** (`deviceName` of sign-in and of the claim, `desktop_device()`, which never touches libmpv: a missing libmpv never blocks sign-in): the computer's name as its owner set it (its DNS host name, else `COMPUTERNAME`), trimmed to 64 characters, else "Windows", like the mobile app's model name.
- **Requests**: every call goes to the saved origin with `Authorization: Bearer` (the app adds `X-Profile-Id`), never a cookie; images and the home preview carry the session's media key (§20); events stream over `fetch` with the bearer; downloads are `fetch`ed then saved from a blob (the server's `Content-Disposition` names them); the last heartbeat is a `keepalive` `fetch`. The server answers the desktop origin with CORS (§17, §20).
- **Change server**: an entry of the app's tray icon menu ("Change server", "Quit"; no menu bar over the player) and of the screens above, also Ctrl+Shift+U. When a token is kept, the page first signs the session out on the server (`POST /auth/logout` with the bearer, at most 3 s: an unreachable server only lets it expire), then the app forgets the token, stops libmpv and reloads the bundled page on the server address screen with the saved URL filled in; the page replaces itself (`location.replace`), so no history entry (the mouse's back button, Alt+Left) leads back to the signed-out app. The tray asks the page (`desktop://change-server`) and changes server alone after 8 s without it (then the window navigates: the page may hang). One server at a time (§2.3).
- **Server side** (server 1.25.0 and later): CORS for the desktop origins, sign-in with `token: true` or a pairing code, `Authorization: Bearer` and `X-Profile-Id` on every call, the media key for images and the home preview, `Cross-Origin-Resource-Policy: cross-origin` on the media routes and stream URLs (§20); setup and invitations refused from a desktop origin.

### 28.4 Window and security

- One transparent window (`transparent: true`, the webview's background transparent) showing the bundled page only, at `http://tauri.localhost` (never `useHttpsScheme`: an `http://` server would be mixed content). Any navigation elsewhere is refused and opened in the system browser. A new window (a link with `target="_blank"`, `window.open`, a middle click, Ctrl or Shift + click on a link) never opens: another site goes to the system browser, a page of the app (`http://tauri.localhost/…`, meaningless outside the app) is ignored.
- **IPC to the bundled page only**: one static capability (`src-tauri/capabilities/main.json`, local, the main window) grants the commands of §28.6, `core:event:allow-listen`/`allow-unlisten`, `core:window:allow-set-fullscreen`, `allow-is-fullscreen` and the window-button permissions below; each command checks again that the calling page is the bundled one. No remote URL is ever granted IPC.
- **Content-Security-Policy** of the bundled page (`tauri.conf.json`): `default-src 'self'`, scripts and styles `'self'` (Tauri adds the hashes of its own), fonts `'self' data:`, `img-src`, `media-src` and `connect-src` `'self' http: https: data: blob:` (the user's server, whatever its address), `connect-src` also Tauri's IPC (`ipc: http://ipc.localhost`), `worker-src 'self' blob:`, `object-src 'none'`. The server's own CSP is not loosened.
- **No native frame** (`decorations: false`; the edges still resize the window): the page fills the whole window. The host's `chrome` draws the window buttons (minimize, maximize or restore, close) at the top right, 46 × 32 px, outside full screen, and fades them with the player's chrome; pages keep clear of them through `--chrome-inset`. Pressing the top 32 px strip or the shell's header outside a control moves the window; a double click maximizes it. The screens before the app have the same strip and buttons. Permissions: `core:window:allow-is-maximized`, `allow-minimize`, `allow-toggle-maximize`, `allow-internal-toggle-maximize`, `allow-start-dragging` and `allow-close`.
- **One instance** (`tauri-plugin-single-instance`): launching projo again starts no second process; the running app's window comes to the front (unminimized, shown, focused).
- **Shown once painted**: the window is built hidden and shown by `desktop_window_ready` (§28.6), which the page calls once its first screen (the startup splash) is painted, so the transparent window never shows empty while WebView2 starts. Without that call 3 s after the window is built (a page that failed to start), the app shows it anyway.
- **Size and place**: the window never shrinks below 1280 × 720 logical pixels (the size the web app's layouts are drawn for), fitted into the primary monitor's work area when it is smaller. It opens where it was when the app last closed: its outer position (physical pixels), its inner size (logical pixels) and whether it was maximized, saved as `window` in `config.json` when the window closes, the app quits or restarts for an update; full screen and minimized are never saved (the bounds before them are kept), and a maximized window keeps the bounds it restores to. The saved bounds apply when at least half of the window lies on one connected monitor, never below the minimum, the top edge kept inside that monitor's work area (the drag strip stays reachable); otherwise (first launch, a monitor gone, an unreadable value) the window opens at the minimum, centered on the primary monitor's work area. Maximized, it is maximized while still hidden: it never shows at the smaller size first. Debug builds' `PROJO_DESKTOP_TEST_WINDOW=x,y` (scripts driving the app) opens it there, unfocused, and saves nothing. Its icon is the "Ouverture" symbol on a dark rounded square (`design/brand/ouverture/native/windows-desktop.ico`, built and copied to `src-tauri/icons/icon.ico` by `design/brand/ouverture/build-desktop-icon.mjs`), also the tray icon's.
- **Full screen** is the window's (Tauri `setFullscreen`), from the player's button and `F`; `Esc` leaves it (`nativeFullscreen: false`, §10.7).
- **An app, not a browser** (`webview_settings.rs`, on WebView2 through the window's controller): no browser context menu; a right click on an editable field keeps only its spelling suggestions and edit items (undo, redo, cut, copy, paste, paste as plain text, select all), on a selection elsewhere only copy and select all, anywhere else no menu at all. No browser accelerator keys (reload, print, find, save, view source, caret browsing, zoom, back and forward…): `AreBrowserAcceleratorKeysEnabled` off for every page load, and each key down marked not for the browser for the page already loading; the editing and movement keys and the page's own shortcuts still work. Release builds only: debug builds keep the browser's menu and keys for inspecting the page, unless `PROJO_DESKTOP_NATIVE_WEBVIEW=1`.
- **Input** goes to the page only (libmpv `osc=no`, `input-default-bindings=no`, `input-vo-keyboard=no`): the shortcuts and gestures of §10.7 are the web's.
- **Navigation**: every page load of the window stops and hides libmpv (as `mpv_destroy`), so a reload or a crashed page never leaves a picture under another page.

### 28.5 libmpv

- **Own binding**, no wrapper crate nor plugin (the prototype's wrapper crashed reading `MPV_FORMAT_NODE` properties): `libloading` loads `libmpv-2.dll` (the bundled `lib/` resource; next to the executable in development) and declares only the C functions used: `mpv_create`, `mpv_set_option_string`, `mpv_initialize`, `mpv_command`, `mpv_set_property_string`, `mpv_get_property` (`MPV_FORMAT_NODE`), `mpv_observe_property` (`MPV_FORMAT_NODE`), `mpv_wait_event`, `mpv_error_string`, `mpv_free`, `mpv_free_node_contents`, `mpv_terminate_destroy`. A DLL missing or unloadable: `mpv_init` fails and the player shows its error state; never a crash of the app.
- **One instance at a time**, created by `mpv_init`, embedded in the window with `wid` = the window's `HWND`, under the webview. Options: `vo=gpu-next`, `hwdec=auto-safe`, `keep-open=yes`, `force-window=yes`, `target-colorspace-hint=yes` (an HDR picture reaches a display in Windows HDR mode as HDR, otherwise libmpv tone maps it), `osc=no`, `input-default-bindings=no`, `input-vo-keyboard=no`, then the `options` of `mpv_init`, all set with `mpv_set_option_string` before `mpv_initialize`.
- **Event thread**: one thread per instance loops on `mpv_wait_event` and emits to the window: a property change as `mpv://property`; `MPV_EVENT_FILE_LOADED`, `PLAYBACK_RESTART`, `SEEK`, `END_FILE` (its reason, and the `mpv_error_string` of its error) and `SHUTDOWN` as `mpv://event`; it ends after `SHUTDOWN`. Nodes become JSON: `NONE` → absent, `STRING` → string, `FLAG` → boolean, `INT64` and `DOUBLE` → number, `NODE_ARRAY` → array, `NODE_MAP` → object, `BYTE_ARRAY` → absent; every node is freed (`mpv_free_node_contents`).
- **Distribution**: the build expects `apps/desktop/src-tauri/lib/libmpv-2.dll`, never committed (`.gitignore`). `bun run --cwd apps/desktop fetch-libmpv` downloads it from the GitHub releases of `zhongfly/mpv-winbuild`, asset `mpv-dev-lgpl-x86_64-*` of a release pinned in the script and checked against its SHA-256 (§20: pinned dependencies). The LGPL build only, never a GPL one: libmpv is linked dynamically, shipped unmodified as a resource with its licence text and the location of its source.

### 28.6 IPC contract

The web's `mpv` engine and the desktop host rely on exactly this contract. It is additive (a later app adds commands, events or fields, never changes these). Since 0.5.0 the UI ships with the app, so it always matches the app's own contract; the "since" notes stay for the transitional chunk of §28.1, which treats a refused command as an older app. A failing command rejects with `{ code, message }` (for libmpv, the `mpv_error_string` of its error, or why the instance is missing).

| Kind | Name | Payload → result |
|---|---|---|
| command | `mpv_init` | `{ options?: Record<string, string> }` → nothing. Idempotent: creates the instance if there is none. |
| command | `mpv_command` | `{ args: string[] }` → nothing (`mpv_command`, e.g. `["loadfile", url, "replace", "start=42,pause=yes"]`, `["sub-add", url, "select"]`). |
| command | `mpv_set_property` | `{ name: string, value: string }` → nothing (`mpv_set_property_string`). |
| command | `mpv_get_property` | `{ name: string }` → the property as JSON (node format), or `undefined` when it has no value. |
| command | `mpv_observe` | `{ names: string[] }` → nothing; each name observed once, in node format, reported by `mpv://property`. |
| command | `mpv_destroy` | `{}` → nothing: stops playback, hides the picture, destroys the instance (`mpv_terminate_destroy`); the next `mpv_init` creates a new one. |
| command | `desktop_window_ready` | `{}` → nothing: shows the window, hidden until then, and focuses it (§28.4); the page calls it once its first screen is painted. Idempotent. Since 0.8.0. |
| command | `desktop_info` | `{}` → `{ version: string, mpv: string, deviceName: string }` (the app's version, libmpv's `mpv-version`, the device name of §28.3; `deviceName` since 0.5.0). |
| command | `desktop_device` | `{}` → `{ deviceName: string }`: the device name of §28.3, without libmpv. Since 0.5.0. |
| command | `desktop_update_status` | `{}` → `{ ready?: string }`: the version downloaded, verified and waiting to be installed (§28.10). Since 0.3.0. |
| command | `desktop_update_install` | `{}` → nothing: destroys libmpv, runs the waiting installer quietly and starts the app again on the new version (the process exits); rejects when no version is waiting. Since 0.3.0. |
| command | `get_server` | `{}` → `{ serverUrl?: string }`: the saved server's origin. Since 0.5.0. |
| command | `check_server` | `{ url: string }` → `{ serverUrl: string, version: string }`: `url` reduced to an origin, its `/health` checked from Rust (`serverUrl`: the origin that answered, after an `http`→`https` upgrade of the same host and port); saves nothing. Rejects with `server/invalid_url`, `server/unreachable` or `server/not_projo`. Since 0.5.0. |
| command | `save_server` | `{ url: string }` → `{ serverUrl: string }`: saves the origin (`config.json`); another origin than the saved one forgets that one's token. Rejects with `server/invalid_url` or `desktop/config_not_saved`. Since 0.5.0. |
| command | `get_token` | `{}` → `{ token?: string }`: the saved server's token from the Credential Manager (none without a saved server). Rejects with `desktop/keyring_failed`. Since 0.5.0. |
| command | `set_token` | `{ token: string }` → nothing: keeps it for the saved server. Rejects with `desktop/no_server` or `desktop/keyring_failed`. Since 0.5.0. |
| command | `clear_token` | `{}` → nothing: forgets the saved server's token (none kept is not an error). Rejects with `desktop/keyring_failed`. Since 0.5.0. |
| command | `change_server` | `{}` → nothing: forgets the token, destroys libmpv and replaces the bundled page with the server address screen (`?change=1`, no history entry); the page calls it once it signed out on the server. Since 0.5.0 (before, it went back to the first-launch page). |
| event | `mpv://property` | `{ name: string, value: unknown }` (JSON from the node; absent when the property has no value). |
| event | `mpv://event` | `{ event: 'file-loaded' \| 'playback-restart' \| 'seek' \| 'end-file' \| 'shutdown', reason?: 'eof' \| 'stop' \| 'quit' \| 'error' \| 'redirect', error?: string }` (`reason` and `error` on `end-file` only). |
| command | `media_session_set` | `{ title: string, subtitle?: string, artworkUrl?: string, actions: string[] }` → nothing: shows the title in Windows' system media controls (§28.7). `actions` among `play`, `pause`, `seekbackward`, `seekforward`, `seekto`, `nexttrack`; `title` and `subtitle` at most 512 characters; `artworkUrl` an `http(s)` URL on the saved server's origin. Rejects with `media/invalid` or `media/unavailable`. Since 0.6.0. |
| command | `media_session_state` | `{ playing: boolean, positionMs: number, durationMs: number, rate: number }` → nothing: playing or paused, and the timeline. Since 0.6.0. |
| command | `media_session_clear` | `{}` → nothing: the system media controls forget the title and hide. Since 0.6.0. |
| event | `media://action` | `{ action: 'play' \| 'pause' \| 'seekbackward' \| 'seekforward' \| 'seekto' \| 'nexttrack', seekTimeMs?: number }`: a media key or Windows' media overlay asked it (`seekTimeMs` with `seekto`). Since 0.6.0. |
| event | `desktop://update` | `{ version: string }`: a newer version is downloaded and verified (§28.10). Since 0.3.0. |
| event | `desktop://change-server` | nothing: the tray's "Change server"; the page signs out, then calls `change_server` (§28.3). Since 0.5.0. |

### 28.7 Playback

- The desktop host's `playerEngine` gives the `mpv` engine (§5.2, §5.3; `html-video` outside the app); everything above the engine is the web player of §10.7, with the capabilities of its `mpv` column.
- The engine declares the capabilities of §10.2 (`engine: mpv`, `subtitleDelivery: engine`), gets `direct` at original quality and `hls_transcode` below it, loads the session's stream URL resolved against the host's server origin (`loadfile`, start position and pause from the session; a capability URL, no credential needed), then applies the resolved tracks (§10.4). `mpv-events.ts` turns the observed properties and events into `MediaEvent`s for the reducer of `@projo/player`.
- Volume and mute are libmpv's (`volume` 0 to 100, `mute`), remembered per device like the browser's. Leaving the player calls `mpv_destroy`.
- **System media controls** (SMTC, `media_session.rs`, through the host's `systemMedia`, §5.2): the app's own binding on the `windows` crate (`ISystemMediaTransportControlsInterop::GetForWindow` on the window, no wrapper crate). While the player shows a title, Windows' media overlay (volume keys, the quick settings' media panel) shows it as a video: the line the browser's Media Session shows first (the movie, or the episode line), the series under it, the poster: the app downloads the server's image URL (with the media key; any URL off the saved server is refused, 10 s, 5 MB at most) and converts it to a JPEG at most 500 px wide through Windows' imaging codecs, since the system media controls ignore the server's WebP; a failure only leaves the overlay without artwork. Play, pause, −10 s and +10 s, the position bar and "Next" (only when there is a next episode) act on the player, as do the keyboard's and headsets' media keys, whether the window has focus or not (`media://action`). The page posts playing or paused, the position, the duration and the speed on play, pause, seek, speed and duration changes. Leaving the player, `mpv_destroy`, a change of server, any page load of the window and closing the app clear it: the overlay disappears.
- Closing the window ends the session like closing a tab: the host's last heartbeat (a `keepalive` `fetch`, §10.6), otherwise the 60 s without heartbeat.

### 28.8 Tests

- The playback logic is tested once for every engine (§22): the controller against the fake engine, the engine contract suite against the fake engine and against `mpv-events.ts` fed with libmpv sequences recorded from the desktop app.
- The desktop host's logic is pure and unit-tested with `bun test` (`apps/desktop/web/src/*.test.ts`): the connection steps (check, version gate, setup status, then save), the screens they lead to, the sign-out before a change of server, the bearer on every request, the token session, download names; the package's code sign-in (`claimPairing`) with the package's tests.
- Rust unit tests (`cargo test`): node → JSON conversion, server URL validation and origin normalisation, the `http`→`https` upgrade rule, the device name, the credential store's "no entry", the system media payloads (lengths, artwork on the saved server only) and the media buttons' actions, the tray's language, the pending change of server, the newest release tag, the window's placement (saved bounds against the monitors, the minimum, centering) and the bounds it remembers (maximized, full screen, minimized), `config.json` with and without them, new-window requests, the context menu's items kept per target.
- The TypeScript of `apps/desktop` goes through `bun lint`, `bun run typecheck` and `bun fmt` with the rest. No automated test drives libmpv, the window or the Credential Manager; the Rust tests run on a Windows runner in the desktop release job only (§28.10).
- Manual checks on Windows before each desktop release: first launch (server address, a wrong address, a server too old, a server not set up); sign-in with a password and with a code, the device's name in "Account and devices"; quitting and launching again signed in (the token in the Credential Manager, `Control Panel → Credential Manager → Windows Credentials`); sign-out, and a revoked device sent back to sign-in; artwork, the home preview, trickplay; the admin's live updates (events) and a logs export; MKV HEVC 10-bit HDR10, Dolby Vision and AV1 files; PGS, ASS and an external SRT; DTS-HD MA and TrueHD; a lower quality (HLS) with subtitles on time; seek, pause, resume and heartbeat; an audio change in place with its toast; the "Next episode" thumbnail; full screen, resize, moving between monitors of different DPI; no empty or transparent window at launch, the window showing within 3 s even with a broken page; the window reopening where it was, maximized too (no frame at the smaller size first), on a second monitor of another scale, and centered on the primary monitor once that monitor is unplugged; a second launch bringing the running app to the front (minimized, behind another window) without a second process; a link to another site opening in the browser, a middle click or Ctrl + click on a link of the app doing nothing; the mouse's back button after "Change server" not returning to the app; a right click on the page, an image or a link showing no menu, on a text field only its spelling suggestions and edit items (each working), on selected text only copy and select all; F5, Ctrl+R, Ctrl+Shift+R, Ctrl+P, Ctrl+F, F3, Ctrl+S, Ctrl+U, F7, Ctrl+plus or minus, Alt+Left and Alt+Right doing nothing from the first page on, while Ctrl+C, Ctrl+V, Ctrl+X, Ctrl+A and Ctrl+Z in a text field, the player's keys and Alt+F4 still work (in a debug build with `PROJO_DESKTOP_NATIVE_WEBVIEW=1`, and in the release build); the media keys (play, pause, next) with the window focused and not, a remote's media keys; an Xbox controller (the d-pad and stick through the home, a title and the player, A and B, X play/pause, LB/RB seek, Y a card's menu, a held d-pad repeating, plugged and unplugged while the app runs, nothing happening while the window is not focused), Windows' media overlay with the title, series and poster, its position bar seeking, "Next" only with a next episode, the overlay gone after leaving the player; the tray's "Change server" and "Quit"; server unreachable at launch; a server update while the app runs.

### 28.9 What it does not do

- No Picture-in-Picture, no AirPlay. No global shortcuts: the media keys reach the player through the system media controls (§28.7), the player's shortcuts, and a gamepad (§19), are the page's while it has focus.
- No jump list nor notifications yet ("resume", "new episode": a product decision shared with the mobile app first).
- No offline playback nor download (§2.3), no several servers at once.
- No setup of a fresh server, no invitation, no OAuth consent: they open in the system browser (§28.1).
- No audio passthrough to an amplifier: libmpv decodes to PCM.
- No Linux build yet, no notarized macOS app (§28.11).

### 28.10 Releases and updates

- **Release** (jobs `desktop-build-windows`, `desktop-build-macos` and `desktop-release` of `.github/workflows/ci.yml`): on a push to `main`, once lint, types and tests passed, when the version of `apps/desktop/package.json` has no `desktop-vX.Y.Z` release yet (stable `X.Y.Z` only, above the previous `desktop-v*` tag; nobody pushes a `desktop-v*` tag). Each platform builds on its own runner (Windows, and macOS on Apple silicon): `fetch-libmpv`, the UI's build (`build:web`), `cargo test`, `bun run --cwd apps/desktop build` (which builds the UI again), then `apps/desktop/scripts/package-release.ts` packs its files and signs its update for the updater with the minisign key of the secrets `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` (the signature carries the version, `--app-version`): `projo-desktop-X.Y.Z-setup.exe` on Windows; `projo-desktop-X.Y.Z-macos-arm64.dmg` (the download) and `projo-desktop-X.Y.Z-macos-arm64.app.tar.gz` (the update) on macOS, after `codesign --verify --deep --strict` of the app. `desktop-release` gathers them, writes `latest.json` (`write-updater-manifest.ts`, Tauri updater format: `version`, `pub_date`, a `windows-x86_64` and a `darwin-aarch64` entry with their signature and URL on the same release; both platforms or no release) and publishes the GitHub release `desktop-vX.Y.Z` ("projo desktop X.Y.Z") with those files and notes generated from the commits that touch `apps/desktop` or the packages its UI bundles (`packages/web-app`, `design`, `i18n`, `player`, `shared`) since the previous `desktop-v*` tag. It is never marked "latest": `/releases/latest` stays the server's (§16.4), and the website's changelog lists the `vX.Y.Z` releases only; its download page (`/download/`) links the newest `desktop-v*` release's installer and disk image, read at build time, and redeploys after a desktop release.
- **The UI ships with the app**: a change of the web app (`@projo/web-app`, `@projo/design`, `@projo/i18n`) reaches the desktop at its next release, not with the server. A desktop release goes out when the web app changed in a way the desktop should have.
- **Server first**: the desktop app refuses a server below its minimum (`projo.minimumServerVersion` of `apps/desktop/package.json`, read by the UI and by CI, §28.3), so that server version ships first. `release-plan` refuses a desktop release while the tag `v<minimum>` does not exist ("publish server vX.Y.Z first"): publish the server release, then bump the desktop app in a later push. The next server release must be at least that minimum.
- **Publishing**: run the manual checks of §28.8, bump `version` in `apps/desktop/package.json`, commit `chore(release): desktop X.Y.Z`, push `main` once the server it requires is released.
- **From 0.4.0** (the server's page in the window, a cookie session) to 0.5.0 (the bundled UI, a bearer token in the Credential Manager): the cookie does not carry over, so users sign in again once after the update (password or a pairing code).
- **Updates** (`tauri-plugin-updater`, release builds only): a minute after launch then every 6 hours, the app lists the `desktop-v*` tags (`GET https://api.github.com/repos/LeoMartinDev/projo/git/matching-refs/tags/desktop-v`) and takes the highest `X.Y.Z`. Above its own version, the updater reads that release's `latest.json`, downloads the installer and checks its signature against the public key of `tauri.conf.json` (`plugins.updater.pubkey`), including the version it was signed for (`requireSignedVersion`). A verified installer waits for the app to quit: once libmpv is destroyed, it runs quietly (`installMode: quiet`, per-user install, no UAC prompt) and the app does not restart; the next launch is the new version. Never an interruption of playback. A failure (network, GitHub rate limit, signature) is logged and tried again at the next check.
- **Restart now**: once a version is ready (`desktop://update`, or `desktop_update_status` when the app mounts), the update banner (§16.4, the desktop host's `updates`), hidden on the player, says "App update ready" with "Restart" (`desktop_update_install`): the installer runs quietly and the app starts again on the new version. Ignored, the version still installs when the app quits. Debug builds never check; `PROJO_DESKTOP_TEST_UPDATE=<version>` makes one pretend that version is ready, and "Restart" then only restarts it.

### 28.11 macOS

The same app, UI and IPC contract (§28.6) as on Windows; what differs:

- **Origin**: Tauri serves the bundled page at `tauri://localhost` (WKWebView takes no `http` scheme handler); it is the second of `desktopOrigins` (§20), so the app needs a server that lists it (the release after 1.27.1). Tauri's config for Windows alone (NSIS, `libmpv-2.dll`, `.ico`) is `tauri.windows.conf.json`; the shared `tauri.conf.json` has `macOSPrivateApi` (the transparent webview).
- **Window**: the system's frame kept over the page (`TitleBarStyle::Overlay`, title hidden): the close, minimize and zoom buttons at the top left, its rounded corners, shadow and full screen. The host's `chrome` draws no buttons (`WindowControls`, `window-frame.ts`); pages keep clear of the system's through `--chrome-inset-start` (the shell's logo, the player's top bar, the screens' headers, the admin's side bar). WebKit has no `app-region`: pressing the same areas as on Windows (the top 32 px strip, `data-window-drag`, outside a control) moves the window (`start_dragging`), a double click zooms it. WebKit's right-click menu shows on a text field or selected text only (`web/src/context-menu.ts`); there are no browser accelerator keys to turn off.
- **Picture**: libmpv cannot embed into another app's view on macOS (`wid` is Windows, X11 and Android only), so the app draws each frame through libmpv's OpenGL render API (`vo=libmpv`, `mpv_render_context_*`, `video-timing-offset=0`) in a `CAOpenGLLayer` hosted by a view under the webview (`mpv/gl_layer.rs`): the page stays transparent over it. Core Animation draws on the main thread; the render context is created and freed on the lifecycle thread, both under the OpenGL context's lock. HDR as IINA does it: a half-float pixel format and an EDR-capable layer; the app observes `video-params` itself (never reported to the page), and while the video is PQ or HLG on BT.2020 or P3 primaries and the screen's potential EDR headroom is above 1, libmpv renders PQ (`target-trc=pq`, `target-prim` the video's, `target-peak` = headroom × 100 nits, tone mapping what the screen cannot reach) and the layer is tagged `itur_2100_PQ` or `displayP3_PQ` with extended dynamic range; otherwise sRGB, `auto` targets, no EDR. `hwdec=auto-safe` decodes on VideoToolbox.
- **libmpv**: an LGPL build, like Windows' (§28.5): `fetch-libmpv` downloads `libmpv.dylib` and its 17 dependencies (FFmpeg 6.0 with every LGPL decoder, TrueHD included; libass; dav1d; mbedTLS…) from a pinned release of `media-kit/libmpv-darwin-build` (`macos-arm64-video-full`: mpv 0.36 built with `-Dgpl=false`, without libplacebo), each checked against its SHA-256, into `src-tauri/lib/macos/` (gitignored). The bundle copies them to `Contents/Frameworks/` (`tauri.macos.conf.json`); the libraries name each other `@rpath/…` and the executable's rpaths are `@executable_path/../Frameworks` and, in debug builds, `src-tauri/lib/macos` (`build.rs`). Debug builds fall back to Homebrew's (`brew install mpv`, a GPL build, never bundled). An option this libmpv does not know (`target-colorspace-hint`, and `osc`, `load-scripts`, `ytdl` without scripting) is skipped, never an error; ASS overrides go through `sub-ass-force-style` before mpv 0.37. Without libplacebo, Dolby Vision profile 5 is not reshaped (profile 8 plays as HDR10).
- **Distribution**: the app (`projo.app`, macOS 11 or later, Apple silicon) and its disk image, signed ad hoc (`signingIdentity: "-"`, no hardened runtime: an ad hoc signature would fail its library validation), neither Developer ID nor notarization: Gatekeeper blocks the downloaded app at its first launch until "Open Anyway" in System Settings → Privacy & Security (the download page says so). Updates (§28.10) replace the app in place (`tauri-plugin-updater`, the `.app.tar.gz` checked against the same minisign key); the downloaded update is not quarantined.
- **Token** in the login keychain (the `keyring` crate's `apple-native` backend, same service and user as on Windows). **Device name**: the computer's name of System Settings (`scutil --get ComputerName`), else "Mac". **Config** in `~/Library/Application Support/dev.leomartin.projo.desktop/`.
- **Icon**: `design/brand/ouverture/native/macos-desktop.icns` (Apple's grid: the Windows icon's dark rounded square at 824 px with a soft shadow on 1024 px), copied to `src-tauri/icons/icon.icns` with `icon.png` (the Dock outside a bundle) by `build-desktop-icon.mjs`; the menu bar takes `icons/tray-template.png`, a template image the system tints.
- **Not yet**: a Developer ID signature and notarization, an Intel build, the system media controls (`media_session.rs` does nothing outside Windows), Dolby Vision profile 5.

---

## 29. Live TV (IPTV)

### 29.1 Goal and scope

A household that has an IPTV subscription (an M3U playlist, an Xtream Codes account, or a Freebox) watches its live channels in projo, next to its movies and shows: a "TV" page, the programme on now and the next one, and the same player. projo ships no playlist, names no provider and suggests none: the admin brings their own source.

- **In**: live channels from any number of sources, a now / next guide, favourites per profile, on the web and the desktop app.
- **The server always relays** (§29.4): a client never talks to the provider. Many sources are reachable only from the server's network (a Freebox serves RTSP over UDP on its LAN only), a browser plays neither MPEG-TS nor RTSP, the provider's URL carries its credentials, and providers cap simultaneous connections.
- **Not in this version** (§29.10): the provider's VOD and series, replay, recording, rewinding the live further than its replay window (§29.4), the mobile app.

### 29.2 Sources

A **TV source** is one subscription, added by the admin (Admin → TV). Three kinds behind one port (`TvSourceProvider`: list the channels, read the guide, give a channel's upstream URL):

| Kind | Settings | Channels | Guide |
|---|---|---|---|
| `m3u` | playlist URL (`http`/`https`), optional XMLTV URL, optional `User-Agent` (visible ASCII: a header value) | `#EXTINF` entries: `tvg-id`, `tvg-name`, `tvg-logo`, `tvg-chno`, `group-title`; `#EXTVLCOPT:http-user-agent` and `http-referrer` kept per channel. Upstream URLs: `http`, `https`, `rtsp`, `rtp`, `udp` | the XMLTV URL of the settings, else the playlist header's `url-tvg` / `x-tvg-url`; matched on `tvg-id` |
| `xtream` | server URL (`http`/`https`, a host and an optional port), username, password | the panel's `player_api.php`: the account, `get_live_categories`, `get_live_streams`; upstream `/live/<user>/<pass>/<id>.ts` (`.m3u8` when the account does not allow `ts`) | the account's `xmltv.php` |
| `freebox` | box address (default `http://mafreebox.freebox.fr`) | the box's TV API (`/api/v8/tv/bouquets/freeboxtv/channels` joined with `/tv/channels`), one channel per service with its best `rtsp` stream (HD, else auto, else standard); channels without a stream, or outside the line's subscription, are left out | the box's `/tv/epg/by_time/` API, hour by hour |

- **Not live, ignored**: playlist entries that are files (`.mkv`, `.mp4`, `.avi`…, Xtream `/movie/` and `/series/` paths) and channels without video (radios).
- **Nothing is visible until enabled**: playlists commonly hold thousands of channels. The source's dialog lists its groups and channels; the admin enables groups (channels added to an enabled group later are enabled too) or single channels.
- **Refresh**: on creation, daily, and by hand (`refresh_tv_source`). A channel keeps its id across refreshes (key: Xtream stream id, Freebox uuid, M3U `tvg-id` and name, else group and name: providers give one `tvg-id` to every quality of a channel), so favourites survive. A channel gone from the source is hidden at once and deleted after 7 days.
- **Connections**: `max_connections` per source: read from the Xtream account (`user_info.max_connections`) by each refresh, which the admin cannot change; set by the admin for the others (empty = no limit).
- **Channel snapshots**: a still per channel for the TV page's cards, from its running streams for free, and from budgeted background grabs that never take a source's last free connection; on or off per source, off by default when the source allows one connection (§29.4).
- **Connectors**: one adapter per kind (`infrastructure/tv/{m3u,xtream,freebox}/`); channels, guide, relay and player never know a channel's kind. `m3u` is the universal format and `xtream` the API of most paid providers: together they cover nearly every subscription. `freebox` only adds the logos and the guide the box's own M3U playlist lacks.
- **Authentication to the provider**: no interactive sign-in. The admin enters the settings once and the server replays them on every request: for `m3u` the secret is part of the playlist URL (token or credentials in the query), plus the `User-Agent` some providers require; for `xtream` the username and password go in each API call and each stream URL; `freebox` has none (the box answers its own network without credentials). Stored as they are in `tv_sources.settings`, like the TMDB key: the server must read them back to open a stream. Viewers only ever authenticate to projo.
- **Secrets**: the source's URL, credentials and every upstream URL stay on the server; the admin API returns them masked. Logos are downloaded and served by the server (`/tv/channels/:id/logo`), never hotlinked.
- A refresh that fails three times raises the notification `tv/source_unreachable`, resolved by the next success; the channels stay as they were.

Data (`infrastructure/sqlite/schema/tv.ts`): `tv_sources` (kind, name, settings JSON, `max_connections`, last refresh and error, last guide attempt, the channel snapshots' switch and grabs per hour), `tv_channels` (source, key, name, number, group, logo, upstream, guide key, the admin's guide channel and the one the last guide read matched, `enabled`, `missing_since`, cached probe, snapshot taken, last snapshot attempt and consecutive failures, last watched), `tv_groups` (source, name, `enabled`), `tv_programmes` (channel, start, end, title, subtitle, description, categories, kind, episode, image URL), `tv_guide_channels` (source, guide channel id, display names), `tv_programme_images` (URL hash, file, fetched or failed), `tv_favorites` (profile, channel, position).

**M3U in detail** (`infrastructure/tv/m3u/`, a pure line parser tested on fixtures):

- Fetched with the source's `User-Agent` (none: the runtime's default), redirects followed one by one (at most 5, to `http` or `https` only, never from `https` down to `http`: the URL carries the secret; `tv/source_unreachable` with `too_many_redirects`, `unsupported_redirect` or `insecure_redirect`), 60 s at most, read as a stream and refused past 64 MB. Decoded as UTF-8 (BOM dropped, `CRLF` accepted); a gzip `Content-Encoding` is undone by the client.
- Header `#EXTM3U`: its `url-tvg` or `x-tvg-url` attribute (the first URL of a comma-separated list) is kept on the source as the discovered guide URL (§29.3).
- `#EXTINF:<duration> <attributes>,<title>`: attributes are `key="value"` pairs (the title starts at the first comma outside quotes). Name: the title, else `tvg-name`, trimmed, whitespace collapsed; an entry with neither is ignored. Number: `tvg-chno` when it is a positive integer. Group: `group-title`, else the last `#EXTGRP:`, else none. Logo: `tvg-logo` when `http`/`https`. Guide key: `tvg-id`.
- `#EXTVLCOPT:http-user-agent=` and `http-referrer=` (also `http-referer=`) between an `#EXTINF` and its URL apply to that channel only. Every other `#` line is ignored.
- The URL is the first non-comment line after the `#EXTINF`; a URL without one is ignored. Kept only for the schemes `http`, `https`, `rtsp`, `rtp`, `udp`.
- **File, not live**: a URL whose path ends in a video file extension (`.mkv .mp4 .m4v .avi .mov .wmv .flv .webm .mpg .mpeg .divx .ogv .3gp .iso`) or holds a `/movie/` or `/series/` segment. **Radio**: an entry with `radio="true"` or whose path ends in an audio extension (`.mp3 .aac .m4a .ogg .oga .opus .flac .wav`). Both are ignored.
- Channel key: `tvg:<tvg-id>|<name>` when `tvg-id` is set, else `name:<group>|<name>`. A key seen again in the same playlist is a duplicate: the first entry wins.
- `tv/source_unreachable`: the request failed (network, timeout, HTTP status ≥ 400); its context holds the host and a fixed reason (`timeout`, the error's code such as `ECONNREFUSED`, `http_status`), never the URL nor the runtime's error message, which may quote it with its secret. `tv/source_invalid`: the answer is not a playlist (no `#EXTM3U` first line and no `#EXTINF`), is too large, or holds no live channel at all (a provider's empty answer never hides every channel).

**Refresh in detail**:

- Groups are matched by name within the source; a channel without a group belongs to the source's unnamed group (the interface calls it "Other channels"). Groups and channels keep the playlist's order (`position`).
- A known key updates the channel (name, number, group, logo URL, upstream, guide key) and clears `missing_since`; it keeps its id and `enabled`. A new key is created enabled if its group is enabled, disabled otherwise (a new group starts disabled). A channel absent from a successful refresh gets `missing_since` (hidden from viewers and from the admin's lists, enabled flag kept); one missing for 7 days is deleted with its logo, and a group left without channels is deleted.
- **Groups and channels**: a channel's `enabled` is what viewers see. Enabling or disabling a group sets its flag and every one of its channels; a channel can then be switched on its own without changing its group's flag. A group's flag only decides the state of the channels it gains later.
- A failed refresh changes no channel; it records the error and counts consecutive failures on the source. The job fails without a `job/failed` notification: at 3 consecutive failures the source raises `tv/source_unreachable` (context: source id and name, error code), resolved by the next success. One attempt per job; the daily refresh is the retry.
- **Daily**: the hourly task `tv-sources-refresh` queues `refresh_tv_source` for every source whose last attempt is more than 24 hours old. Creating a source, or changing what its listing reads (an `m3u` source's playlist URL or `User-Agent`, an `xtream` source's server URL, username or password, a `freebox` source's address), queues one at once.
- The upstream stored per channel is a URL with the channel's own `User-Agent` and referrer; the port's `upstreamOf` completes it from the source (its `User-Agent` when the channel has none). An `xtream` channel's upstream is stored without its credentials, which `upstreamOf` adds from the source's current settings when a stream opens (below).

**Freebox in detail** (`infrastructure/tv/freebox/`, a pure mapping tested on fixtures trimmed from a real box's answers; read-only `GET`s of the box's own API: no app token, no session, nothing ever written to the box):

- **Address**: `http`, a host and an optional port, nothing else (no user info, path, query or fragment; a trailing `/` is accepted); default `http://mafreebox.freebox.fr`. Never `https`: a box's certificate chains to Freebox's own authority, which the server does not trust. It holds no secret: the admin API returns it as it is. The box answers its own network only, so the server must be on it (Docker: §29.4).
- **Discovery**: `GET <address>/api_version` → `{ api_base_url, api_version, box_model_name, … }`. `api_base_url` (a path, `/api/`) prefixes every call; `api_version` is `"<major>.<minor>"` (`16.1` on a Freebox v9). The TV API is read at version 8 (`<api_base_url>v8/tv/…`, the shapes below), which later Freebox OS versions keep serving; a major below 8 is `tv/source_invalid` (`api_too_old`).
- **Every call**: redirects followed one by one while they stay on the address's origin (at most 5; any other is `not_freebox`), 30 s and 16 MB at most per answer, JSON validated at the boundary. An answer that is not JSON or not the API's envelope `{ success, result }` is `tv/source_invalid` (`not_freebox`); `success: false` is `tv/source_invalid` (`api_error`, with the box's `error_code` when it is a plain identifier, and the HTTP status), whatever its HTTP status: the box sends its refusals with one (403 `auth_required`, 404 `invalid_request`). An entry that does not match its shape is skipped, not the whole answer.
- **Channels**: `GET …/v8/tv/channels` → `result: { <uuid>: { uuid, name, short_name, logo_url, available, has_service, has_abo } }`, and `GET …/v8/tv/bouquets/freeboxtv/channels` → `result: [{ uuid, number, sub_number, available, pub_service, streams?: [{ type, quality, rtsp, hls }] }]` (the box's numbering). A bouquet entry is kept when its `available` is true (`false`: a channel outside the line's subscription, which never plays), it has a stream with an `rtsp` URL, and its uuid is in `tv/channels`. A uuid listed at several numbers (France 3's regions at `3` with a `sub_number` and again in the 900s) is one channel, at its entry with the lowest `number`, then `sub_number`. Channels are ordered by `number`, then `sub_number`. The bouquet holds no radio (and no field would tell one): nothing else is filtered.
- **Stream**: of the entry's streams with an `rtsp` URL, by `quality`: `hd`, else `auto`, else `sd`, else `ld`, else the first. Its `rtsp` URL is the upstream as the box gives it (`rtsp://mafreebox.freebox.fr/fbxtv_pub/stream?namespace=1&service=<n>[&flavour=hd|sd]`; nothing added, no `User-Agent` nor referrer); only the `rtsp` scheme is accepted, the `hls` URLs are ignored. The relay opens it like any RTSP upstream (TCP, then UDP, §29.4: a Freebox answers over UDP).
- **A channel**: key the `uuid` (`uuid-webtv-<n>`); name `name`, trimmed with whitespace collapsed; number `number` when a positive integer (`sub_number` only orders); group `Freebox TV` (the bouquet's name: one group per source); logo `logo_url` (a path on the box, `/api/latest/tv/img/channels/logos68x60/<uuid>.png`) resolved against the address and kept only on its origin (another host's URL is dropped), downloaded like any logo; guide key the uuid.
- **Errors**: `tv/source_unreachable` as for M3U (network, timeout, an HTTP status ≥ 400 whose body is not the API's envelope; the host and a fixed reason). `tv/source_invalid`: `not_freebox`, `api_error`, `api_too_old`, `too_large`, `no_live_channel` (nothing kept: the channels stay as they were).

**Xtream Codes in detail** (`infrastructure/tv/xtream/`, a pure mapping tested on fixtures; read-only `GET`s of the panel's `player_api.php`, the de-facto API of Xtream UI and XUI.one panels, documented by its many clients only):

- **Settings**: server URL `http` or `https`, a host and an optional port, nothing else (no user info, path, query or fragment; a trailing `/` is accepted): the panel's root as providers give it (`http://line.example.com:8080`). Username and password: 1 to 200 characters, neither whitespace nor control characters; percent-encoded wherever they are sent. The admin API returns the server URL as its origin (`<scheme>://<host>[:port]`, the parts M3U's masking keeps) and never the username nor the password.
- **Every call**: `GET <server>/player_api.php?username=<u>&password=<p>[&action=<a>]`, redirects followed one by one (panels move behind load balancers and to `https`; the provider names its own hosts), at most 5, to `http` or `https` only and never from `https` down to `http` (it would send the credentials in clear): `tv/source_unreachable` (`too_many_redirects`, `unsupported_redirect`, `insecure_redirect`); 60 s and 64 MB at most per answer, no `User-Agent` of its own (the runtime's). JSON validated at the boundary, leniently: panels write numbers as numbers or strings and leave fields `null` or empty, so a field accepts either and an unreadable optional field counts as absent; an entry that does not match its shape is skipped, not the whole answer.
- **Account**, read first by each refresh (no `action`) → `{ user_info: { auth, status, exp_date, max_connections, allowed_output_formats, active_cons, … }, server_info }`. `auth` other than `1`, or an HTTP 401, is `tv/account_refused` (`auth_failed`); a `status` other than `Active` (ignoring case) is `tv/account_refused` with `expired`, `banned` or `disabled` for those statuses, `inactive` for any other; an `exp_date` (Unix seconds) in the past is `expired` too. `max_connections`, a positive integer, is written to the source's `max_connections` by each successful refresh (absent, `0` or unreadable: no limit); the admin cannot set it on an `xtream` source, neither on creation nor later (`tv/source_invalid`, 422), the provider enforcing it anyway. `active_cons` is not used (it counts projo's own streams and changes by the second): a connection the provider refuses is an upstream failure (§29.4). `server_info` is ignored: streams stay on the admin's server URL, never on a host the panel names. The expiry date is not shown: an expired account fails its refresh, which the source's state shows.
- **Output format**: `allowed_output_formats` holding `ts`, absent or empty: `.ts` (MPEG-TS, one connection); else holding `m3u8`: `.m3u8` (the provider's HLS, read by ffmpeg); else (`rtmp` only) `tv/source_invalid` (`no_output_format`).
- **Channels**: `action=get_live_categories` → `[{ category_id, category_name, parent_id }]` and `action=get_live_streams` → `[{ num, name, stream_type, stream_id, stream_icon, epg_channel_id, category_id, … }]`. An entry is kept when its `stream_type` is `live`, `created_live` or absent (`radio_streams` is radio, `movie` and `series` are not live), its `stream_id` a positive integer and its name, trimmed with whitespace collapsed, not empty. Key `stream:<stream_id>` (a stream id seen again is a duplicate: the first wins). Number `num` when a positive integer. Group: the `category_name` (trimmed) of its `category_id`, else the unnamed group. Order: the categories' order, then `num`, then the listing's (groups follow the panel's categories). Logo `stream_icon` when an absolute `http`/`https` URL, downloaded like any logo (below: its address rule applies). Guide key `epg_channel_id` when not empty, else none (matched by name, §29.3). `direct_source`, `tv_archive` and every other field are ignored.
- **Upstream**: stored without credentials, `live/<stream_id>.<ts|m3u8>`; `upstreamOf` builds `<server>/live/<username>/<password>/<stream_id>.<ext>` from the source's settings when a stream opens, so a new password applies to the next stream and no channel row holds a credential; a stored upstream of another shape is never opened (`tv/stream_unavailable`). No `User-Agent` nor referrer. ffmpeg follows the panel's redirect to its streaming server (`http`/`https` only, §29.4).
- **Errors**: `tv/source_unreachable` as for M3U (network, timeout, an HTTP status ≥ 400 other than 401; the host and a fixed reason). `tv/account_refused` (above; its reason in the context). `tv/source_invalid`: `not_xtream` (not JSON, or not the API's shape: no `user_info` object, a list that is not an array), `too_large`, `no_output_format`, `no_live_channel` (nothing kept: the channels stay as they were).
- **Credentials**: they are in every URL of the source, so no error, log, job, notification or admin answer ever holds one of its URLs: the host and a fixed reason only. The relay masks every URL ffmpeg or ffprobe quotes (§29.4) and also writes `***` for the username and password, raw and percent-encoded, the longest first: one of 4 characters or more wherever its logged lines hold it, a shorter one where it stands as a token of a URL's path or query (between `/`, `=`, `&`…, quotes or whitespace); an Xtream path quoted without its scheme (`live/<user>/<pass>/`) and any `username=`/`password=` parameter are masked too. The upstream `upstreamOf` returns names them as its secrets.

**Logos**: downloaded only for enabled channels (a playlist holds thousands), by `fetch_tv_logos`, queued after each successful refresh and when channels are enabled. A channel is fetched again when its logo URL changed, or a day after a failed attempt; while a changed URL fails, the previous logo is kept and served. `http`/`https` only, the channel's or source's `User-Agent`, 15 s and 1 MB at most, 4 at a time; the host of the logo and of each redirect (at most 5, followed one by one) must not resolve to a loopback, link-local, unspecified or multicast address (LAN addresses are allowed: a Freebox serves its logos from the LAN); PNG, JPEG, WebP and GIF accepted by their magic signature (SVG refused), stored as they are in `/data/images/tv/<channel id>.<ext>`. A failure is logged, never fails the job. A channel without a logo shows its name.

### 29.3 Guide

What is on now and in the next 3 days, with each programme's details (image, categories, episode, a programme kind). `refresh_tv_guide` (every 6 hours and after a source refresh) reads each source's guide and keeps, for enabled channels only, the programmes ending after 6 hours ago and starting within 3 days (the past hours for the guide grid, §29.6); older ones are deleted. XMLTV files reach hundreds of MB: read as a stream (gzip accepted), never loaded whole. A channel without guide data shows its name alone. Times are stored in UTC; XMLTV offsets are honoured.

**Guide in detail** (`application/tv/refresh-tv-guide.ts`; pure rules in `core/tv/guide.ts`; the XMLTV reader in `infrastructure/tv/xmltv/`, used by the connectors):

- **Where**: the port's `readGuide` streams the source's guide to a sink (its XMLTV channels, then each programme as it is read); only the connector knows where it is. `m3u`: the XMLTV URL of the settings, else the playlist's discovered `url-tvg` (§29.2). `xtream`: `<server>/xmltv.php?username=<u>&password=<p>`, always there, read like any XMLTV URL. `freebox`: the box's EPG (below), always there. A source without a guide location has no guide: its programmes are deleted and nothing is fetched.
- **Fetch**: the source's `User-Agent`, redirects followed one by one (at most 5, to `http` or `https` only, never from `https` down to `http`, which would send a URL's secret in clear: `tv/guide_unreachable` with `too_many_redirects`, `unsupported_redirect` or `insecure_redirect`), 5 minutes at most, refused past 200 MB received or 1 GB once decompressed. The received bytes are counted before any decompression: the client never decompresses (`Accept-Encoding: gzip, deflate`); a `gzip` or `deflate` `Content-Encoding` is undone by the reader (any other is `tv/guide_invalid`), then a body that starts with the gzip signature (`1f 8b`: a `.gz` file served as it is) is decompressed, both as the body streams; decoded as UTF-8. Errors: `tv/guide_unreachable` (network, timeout, HTTP status ≥ 400; context: the host and a fixed reason as in §29.2, never the URL), `tv/guide_invalid` (no `<tv>` root element, a tag, comment or CDATA section left open past 1 MB, a corrupt compression, too large). A long text run is not an error: it is only cut to the lengths below.
- **Parse**: a streaming tokenizer fed chunk by chunk (a tag cut between two chunks waits for its end), never a document tree. Read: `<channel id>` with its `<display-name>`s, and `<programme start stop channel>` with its `<title>`, `<sub-title>`, `<desc>`, `<category>`, `<icon src>` and `<episode-num system>`; every other element is skipped. The five XML entities and numeric references are decoded, any other entity kept as written; CDATA is text; comments, processing instructions and the DOCTYPE are skipped. Texts are trimmed with whitespace collapsed and cut to 300 characters (title, subtitle), 2,000 (description), 100 (category); a programme without a title is skipped.
- **Programme details**: *image*: the first `<icon src>` that is an absolute `http`/`https` URL of at most 2,048 characters (anything else ignored). *Categories*: up to 3, in the order read, each with its `lang` (an empty one, or one equal to an earlier one ignoring case, is skipped). *Episode*: `<episode-num system="xmltv_ns">` gives the season and episode numbers (`season.episode.part`, each part zero-based and optionally `n/total`, spaces ignored: `1.4.0/1` is season 2, episode 5; an empty part, or one that is not a whole number, is absent); `system="onscreen"` is kept as text (cut to 40 characters, `S02E05`), shown only when there are no numbers; other systems are ignored.
- **Times**: `YYYYMMDDhhmm[ss]`, then an optional offset `±hhmm` (also `±hh:mm` and `Z`); without one, UTC (XMLTV's rule). Stored in UTC. A programme whose `start` does not parse is skipped; one without a valid `stop` ends where the channel's next programme starts, and is dropped when none follows.
- **Matching**: each enabled, present channel of the source takes the programmes of one guide channel, by the first of these rules that finds one: (1) the admin's choice for the channel (Admin → TV, §29.6), whatever the others say; (2) a guide channel whose id equals the channel's guide key (M3U `tvg-id`, Xtream `epg_channel_id`, Freebox uuid) ignoring case; (3) one whose id equals it once both drop an `@…` suffix (iptv-org's quality suffix: `France2.fr@SD` takes `France2.fr`); (4) the first guide channel one of whose `display-name`s equals the channel's name once both are normalised (below). Rules 2 to 4 look at the `<channel>` elements read before the first programme (where XMLTV puts them). A guide that lists no channel (the Freebox EPG), and a guide key no rule placed, take the programmes whose `channel` equals the key ignoring case, else equals it without suffix. Several channels may take the same guide channel (the qualities of one channel, §29.2): each gets its programmes. Programmes of no enabled, present channel of the source are dropped as they are read: the reader holds the matched ones only.
- **Normalised name** (rule 4): lowercased, accents removed; a leading country prefix dropped (two or three letters then `:`, `|` or `-`: `FR: `, `|FR| `, `UK - `); every bracketed part `[…]` dropped (`[Geo-blocked]`, `[Not 24/7]`), and a parenthesised part when it holds only quality words; the quality words `sd`, `hd`, `fhd`, `uhd`, `4k`, `8k`, `hevc`, `h264`, `h265`, `hdr`, `50fps`, `backup` and the resolutions (`720p`, `1080i`, `1080p`, `2160p`…) dropped; `+` read as `plus` and `&` as `and`; then every character but letters and digits removed (`TF1 HD` and `TF 1` are `tf1`). A name left empty matches nothing.
- **What matched**: each successful read records, on each channel it filled, the guide channel it took (or none), shown to the admin (§29.6); and stores the source's guide channels (`tv_guide_channels`: id and up to 5 display names, cut to 100 characters, at most 20,000 in the guide's order), the list the admin picks from. A guide without `<channel>` elements leaves that list empty. The admin's choice is stored on the channel (`tv_channels.guide_channel`), kept by every source refresh and guide read, and cleared only by the admin ("Automatic").
- **Language**: of several `<title>` (likewise `<sub-title>`, `<desc>`) in different `lang`, the one in the server's metadata language (§9, its primary subtag: `fr` of `fr-FR`), else one without `lang`, else the first. Programmes are stored once for every profile, so the language is the server's.
- **Window and overlaps** (per channel, once read): the programmes ending after now − 6 hours and starting before now + 72 hours, sorted by start. One starting when an earlier-read one starts is a duplicate (the first read wins); one overlapping the next is cut at the next's start; one that ends at or before its start is dropped; 600 at most per channel (the earliest kept).
- **Write**: a successful read replaces every programme of the source's channels in one transaction, each with its kind (below); a programme whose channel and start were already stored keeps its id (a detail open on it stays valid). A failed read changes nothing (the stored programmes run out by themselves). Programmes ended more than 6 hours ago are deleted by each run and by the hourly task.
- **When**: `refresh_tv_guide` (`dedupe_key = tv_guide:<source id>`, one attempt) is queued after each successful `refresh_tv_source`, when channels of the source are enabled, when its XMLTV URL changes, and by the hourly task `tv-guide-refresh` for each source whose last guide attempt (`tv_sources.guide_attempt_at`) is 6 hours old or more, so a restart does not read every guide again. A source without an enabled channel is not read (its programmes are deleted). A failure is logged with its code and fails the job without a `job/failed` notification (a provider's guide is often flaky); the next run 6 hours later is the retry.
- **Freebox** (`infrastructure/tv/freebox/`, after the discovery of §29.2): `GET …/v8/tv/epg/by_time/<t>` (`t` in Unix seconds) → `result: { <uuid>: { <programme key>: { date, duration, title, sub_title?, desc?, category_name?, picture?, picture_big?, season_number?, episode_number?, … } } }`: every channel's programmes overlapping the UTC hour that holds `t`. The connector reads the hours from the one that holds now − 6 hours to the one that holds now + 72 hours: 79 requests, one at a time, whatever the number of channels (the per-channel `by_channel` would cost one request per enabled channel). `date` is the start and `duration` the length, both in seconds; title `title`, subtitle `sub_title`, description `desc`, category `category_name`; image `picture_big`, else `picture` (paths on the box, resolved against its address and kept only on its origin, like its logos, §29.2); season and episode `season_number` and `episode_number` when positive; no language. A programme listed in several hours is read once (its key). Matched on the channel's guide key, the uuid. Each request 30 s and 16 MB at most, and the whole read (discovery included) 5 minutes, like an XMLTV fetch: past it, the request under way is aborted and the read fails. Any failed request fails the read: `tv/guide_unreachable` (network, timeout, an HTTP status ≥ 400 without the envelope) or `tv/guide_invalid` (not JSON, not the envelope, `success: false`, too large). The rules above apply from **Window and overlaps** on.
- **Now and next** (at request time `t`, §29.7): *now* is the channel's programme with start ≤ `t` < end; *next* the first one starting after `t`.

**Programme kinds** (`core/tv/programme-kind.ts`, pure; ids `tvProgrammeKinds` of `@projo/shared/api/tv`, like genres, labels `programmeKinds.<id>` of `@projo/i18n`): `news`, `sport`, `movie`, `series`, `kids`, `documentary`, `entertainment`, `music`, `other`. Never a provider's category text in the API's place of a kind.

- **A programme's kind** is computed when its guide is read and stored with it. Its categories, in order, each read through the keyword table of its language (`fr` or `en`, by the `lang`'s primary subtag; without `lang`, or in another language, both tables), the English DVB EIT content strings included (`Movie / Drama` → `movie`, `News / Current affairs` → `news`, `Show / Game show` → `entertainment`, `Sports` → `sport`, `Children's / Youth programs` → `kids`, `Music / Ballet / Dance` → `music`, `Arts / Culture (without music)` → `documentary`, `Social / Political issues / Economics` → `news`, `Education / Science / Factual topics` → `documentary`, `Leisure hobbies` → `entertainment`): the first category that names a kind gives it. Without one, the channel's kind.
- **A channel's kind**: the keywords of its group name (`FR | SPORTS`, `News`, `Cinéma`), else of its own name (`Sport`, `Info`, `News`, `Kids`, `Ciné`, `Musique`…), else `other`. Computed when read: it is the kind a channel without a programme on now shows under (§29.6).
- **Keywords**: a text is lowercased without accents and cut into words (letters and digits); a keyword matches a word that starts with it (`documentaire` of `docu`, `séries` of `serie`), a phrase of several words the same run of words; in a channel's group or name a keyword also matches the end of a word (`Eurosport`, `franceinfo`). When one text names several kinds, the first in this order wins: `kids`, `sport`, `news`, `documentary`, `movie`, `series`, `music`, `entertainment` (`Dessin animé` is `kids`, `Magazine sportif` `sport`, `Série documentaire` `documentary`).

**Programme images** (`fetch_tv_programme_images`, §18; `application/tv/fetch-tv-programme-images.ts`):

- Fetched only for the programmes on now and next of enabled, present channels (never the 3 days), by `fetch_tv_programme_images` (`dedupe_key = tv_programme_images`, one attempt), queued after each successful guide read and every 15 minutes by the task `tv-programme-images`.
- The rules of logos (§29.2): `http`/`https` only, the source's `User-Agent`, the host of the image and of each redirect (at most 5, followed one by one) never a loopback, link-local, unspecified or multicast address, 15 s; PNG, JPEG, WebP and GIF by their magic signature (SVG refused), here 2 MB at most; 4 at a time.
- Stored once per URL, keyed by its SHA-256 (`tv_programme_images`; files `/data/images/tv/programmes/<hash>.<ext>`): an image several programmes share (a series' episodes, the same film on two channels) is fetched once. A URL that failed is tried again after 6 hours, an image is fetched again after 7 days. The hourly task deletes the images (row and file) no stored programme refers to any more.
- Served by `GET /tv/programmes/:id/image` (§29.7), never hotlinked: clients never learn the URL. A failure is logged at debug level with the host and a fixed reason (`fetch-failure.ts`), never the URL, and never fails the job.

### 29.4 Relay

- **Channel stream**: one upstream connection per channel, whatever the number of viewers. The first viewer starts it: one ffmpeg reads the upstream and writes a live HLS playlist in `/data/cache/live/<channel>/` (`copy` rendition: video copied, the audio copied if AAC, otherwise transcoded to stereo AAC; fMP4 segments cut on the source's keyframes, about 2 s, a sliding replay window of the last 30 minutes by default: timeshift, below). RTSP is tried over TCP, then over UDP (a Freebox accepts UDP only).
- **`compat` rendition**: when a viewer cannot play the copy (interlaced video on a `browser` engine, which does not deinterlace; a video codec the client does not decode), a second ffmpeg reads the local `copy` stream, never the provider, and produces H.264 (deinterlaced, at most 1080p, §10.3 encoder rules, VAAPI included) with AAC. It is shared by the channel's viewers who need it and takes one transcode slot (§10.3, `playback/transcode_limit_reached`). The `mpv` engine always gets `copy`.
- The channel is probed when its stream first starts (codec, interlacing, audio tracks); the result is cached on the channel and refreshed when a stream fails to start.
- **Audio**: one track, the first that is not an audio description. **Subtitles**: none.
- **Stopping**: a stream without viewers stops after 30 s (zapping back is instant). Segments are deleted with it.
- **Connection limit**: when starting a channel would exceed the source's `max_connections`, a background snapshot grab (below) is stopped first, then streams without viewers; if none, the session is refused with `tv/connection_limit_reached` ("All the provider's connections are in use").
- **Upstream failure**: ffmpeg is restarted up to 3 times (1, 2, 4 s); then viewers get `tv/stream_unavailable`.
- **Live session**: `POST /tv/channels/:id/sessions` with the client capabilities of §10.2 → `{ sessionId, streamUrl, rendition }`; heartbeat every 10 s, gone after 60 s without one, `DELETE` on leaving. The stream is served under the session's capability URL (§20). Live sessions appear in the admin's active sessions and can be stopped there. No progress is ever recorded.
- Docker: a Freebox source needs the container on the box's network, to reach its API and receive its UDP stream (`network_mode: host`); the README says so.

**Relay in detail** (`application/tv/live-streams.ts`: one component holding every channel's stream, its timers and clock injectable; ffmpeg in `infrastructure/tv/live-relay.ts` and ffprobe in `live-prober.ts`, kind-agnostic: they get the upstream from `upstreamOf`):

- **Probe**: a stream's first attempt uses the channel's cached probe (`tv_channels.probe`, `probed_at`); without one, ffprobe reads the upstream (20 s at most in all, `-analyzeduration` 2 s, the same input options as a run): the video codec, profile, pixel format and field order, the audio tracks (absolute index, codec, channels, language, audio-description disposition). RTSP is probed over TCP, then over UDP with what the TCP attempt left of the 20 s (none below 1 s): the probe stays well within the session's 30 s wait. The transport that answered is cached with the probe and used by every run. An attempt whose run lists no segment drops the cache, so the next attempt probes again; so does a `copy` stream that ends *failed*. A probe without a video stream fails the attempt. The probe's connection is closed before the run opens its own: a channel never holds two. A stream stopped while it probes (idle, evicted, shutdown) kills ffprobe, and its stop completes only once ffprobe is gone.
- **ffmpeg** (one run at a time per stream, arguments as an array): the upstream's input options first — `http`/`https`: `-user_agent` and `-referer` (the channel's, its `User-Agent` else the source's, §29.2), `-rw_timeout` 15 s; `rtsp`: `-rtsp_transport` of the probe, `-user_agent`, `-timeout` 15 s; `udp`/`rtp`: `-timeout` 15 s; every scheme: `-protocol_whitelist http,https,httpproxy,tls,tcp,udp,rtp,crypto` first (ffprobe too: never `file` nor any other, so a provider's HLS playlist cannot make the server read its own disk) and `-analyzeduration` 1 s (the streams are known from the probe). Then `-map 0:v:0`, the chosen audio track by its absolute index (none when the channel has no audio), `-c:v copy` (HEVC tagged `hvc1`), `-c:a copy -bsf:a aac_adtstoasc` when the track is AAC, else `-c:a aac -ac 2 -b:a 192k`, no subtitle, data or metadata. Output: `-f hls -hls_segment_type fmp4 -hls_time 2 -hls_list_size 20 -hls_flags independent_segments` (ffmpeg deletes nothing: the server does, timeshift below), run `n` (counted from 1 per stream) writing `run-<n>.m3u8`, `init-<n>.mp4` and `seg-<n>-<00000>.m4s` in the stream's folder; segments are cut on the first source keyframe after 2 s.
- **Served playlist**: the server's own, never ffmpeg's. The stream reads the current run's playlist every 500 ms and appends its new segments to a window numbered across runs. Served: the window (timeshift, below); `#EXT-X-VERSION:7`, `#EXT-X-TARGETDURATION` (pinned by the stream's first segment and never changed, RFC 8216 §4.3.3.1: that segment's duration rounded to the nearest second, at least 2, plus 2 s of headroom, so 4 for a source with keyframes every second or two; a segment lasts less than 2 s plus one keyframe interval, which the first one bounds. A later segment that is longer anyway is served as it is, the target kept, and logged once per stream), `#EXT-X-MEDIA-SEQUENCE`, `#EXT-X-DISCONTINUITY-SEQUENCE`, `#EXT-X-INDEPENDENT-SEGMENTS`, `#EXT-X-START:TIME-OFFSET=-6` (a player starts 6 s behind the live edge), an `#EXT-X-MAP` per run, `#EXT-X-DISCONTINUITY` where a run follows another (its timestamps start again), and `#EXT-X-PROGRAM-DATE-TIME` on the first segment served and on the first of each run; no `#EXT-X-ENDLIST` nor `#EXT-X-PLAYLIST-TYPE`. URIs are relative (`init-2.mp4`, `seg-2-00041.m4s`).
- **Ready**: a stream is ready once its window holds two segments (about 4 s of picture, so a player does not start starved; the player tunes its live sync, J1c). A session is answered once its channel's stream is ready, after 30 s at most: past that, or when the stream fails, the session is not created (`tv/stream_unavailable`) and the stream goes on only for its other viewers.
- **Failed attempt**: a probe that fails, a run that exits by itself, or a run that lists no new segment for 15 s (killed). A run that lists a segment resets the count. After a failed attempt the stream tries again after 1, 2, then 4 s; the fourth consecutive failure ends it as *failed*: folder deleted, no longer a connection, its sessions answered `tv/stream_unavailable` (and ended) on their next heartbeat or stream request (the playlist or any of its files). A new session on that channel starts the stream afresh.
- **Viewers**: a stream's viewers are its live sessions. When the last one ends (left, stopped by the admin, 60 s without heartbeat), the stream stops 30 s later unless a session joins meanwhile: ffmpeg killed, folder deleted.
- **Connection limit**: a source's connections are its streams starting, running or waiting to retry (not the failed ones) and its snapshot grab (channel snapshots, below). A session for a channel without a stream, when the source already holds `max_connections`, stops the source's grab first, then its streams without viewers, the one idle the longest first and only as many as needed; with none to stop, it is refused (`tv/connection_limit_reached`, 503). A starting stream's first attempt waits until every stop of its source under way (evicted, idle, its own channel's previous stream) has its ffmpeg or ffprobe gone, so the provider never sees more than `max_connections`. `compat` streams read the local `copy` stream and are not connections.
- **Folders**: `/data/cache/live/<channel id>/` (`<channel id>-compat/` for the `compat` stream), deleted when its stream stops or fails; a stream's first attempt waits until the previous stream of the same folder (its channel's, same rendition) has its processes gone and its folder deleted; `cache/live` is emptied at startup (no stream survives a restart), and every stream is stopped on shutdown (the module's `stop`).
- **Logs**: start, ready, failed attempts and stop, with the channel and the upstream host, never its URL; ffmpeg's and ffprobe's error lines are logged with every URL in them masked to `<scheme>://<host>/…` and the upstream's secrets to `***` (§29.2), each line masked whole before the output is cut to its end (the relay keeps the last 2,000 characters, the probe 600), so a cut never leaves the tail of a URL or a secret.
- **Upstream**: only an absolute `http`, `https`, `rtsp`, `rtsps`, `rtp` or `udp` URL with a host is opened, whatever the source's kind; anything else (a relative or local path) is refused before any probe or run (`tv/stream_unavailable`, reason `invalid_upstream`).

**`compat` in detail** (the choice in `core/tv/rendition.ts`, pure; the stream in `live-streams.ts` beside the `copy` one, sharing its runs, window, readiness, failed attempts, restarts and idle stop; its ffmpeg in `live-relay.ts`):

- **Choice** (`liveRenditionOf(probe, capabilities)`, at session creation; the session keeps it for its life): `engine: mpv` → `copy`, always. A `browser` engine (also when `engine` is absent) → `compat` when the probe's field order is interlaced (`tt`, `bb`, `tb`, `bt`; `progressive`, `unknown` or none count as progressive), or when its video codec is not in the client's `videoCodecs` by the mapping of §10.2 (`h264` is `avc1` only outside High 10, 4:2:2 and 4:4:4 and at `yuv420p`/`yuvj420p`; `hevc` → `hvc1`, `av1` → `av01`, `vp9` → `vp09`; any other codec, MPEG-2 included, has none); `copy` otherwise. Audio never decides: the copy's audio is always AAC.
- **Probe unknown at session time** (never probed, or dropped): a `browser` session first joins the `copy` stream as its viewer and waits for it to be ready (its first attempt probes); the fresh probe then chooses. A `compat` session joins the `compat` stream, then leaves the `copy` (which the compat stream holds: no idle gap), and waits for the compat stream within the same 30 s. The probe that chooses, at session time and once the copy is ready, is the one the channel's running `copy` stream started its run from (in memory), else the cached one: a cache dropped while the copy runs changes nothing. A probe still unknown once the copy is ready gives `copy`. A probe that fails fails the copy stream: `tv/stream_unavailable`, as before.
- **Input**: never the provider, never a path handed to ffmpeg: the compat ffmpeg reads fragmented MP4 on its stdin (`-f mp4 -i pipe:0`), which the server feeds from the copy stream's current run: its init, its newest two segments (a fast start), then each new segment as the copy's poll lists it. A compat run starts only once the copy is ready. When a new copy run lists its first segment (a copy restart: new timestamps, a new init), the compat run is stopped and a new one started at once on that run, not a failed attempt; the compat's own served playlist marks the discontinuity as for any run. **Backlog**: the server counts the segments fed that ffmpeg has not taken yet; a run that has listed a segment and is more than 3 behind (slower than real time: it would drift ever further from the live edge, and past the copy's window would read holes) is stopped and a new one started at once on the copy's newest two segments, like on a new copy run (not a failed attempt; logged as a warning); a run behind before listing any segment is left to the stall rule (a failed attempt). A copy file that cannot be read anyway is logged as a warning.
- **Holding the copy**: while the compat stream has viewers it is a viewer of the copy stream (the copy stays up and is not idle for the connection limit); when its last viewer leaves, it leaves the copy too, so both idle delays run together. A copy stream that stops (idle, evicted, shutdown) stops its compat stream; one that fails fails it (its run killed, its folder deleted, its sessions answered `tv/stream_unavailable`), and the failed compat stream stays known with its viewers as a failed copy does: a new compat session starts it afresh, its old sessions counted again. One upstream connection per channel, whatever its renditions.
- **ffmpeg**: `-map 0:v:0 -map 0:a:0?`, audio copied (`-c:a copy`), video H.264 `-profile:v high` scaled to at most 1920×1080 keeping the aspect ratio (the 1080p scale of §10.3), keyframes forced every 2 s (`expr:gte(t,n_forced*2)`), no tone mapping. Software: `bwdif=mode=send_frame:deint=interlaced` first when the probe is interlaced, then the scale and `format=yuv420p`; `libx264 -preset veryfast -crf 21 -forced-idr 1 -sc_threshold 0 -x264-params keyint=infinite`. `hw_accel = vaapi` (§10.3): `format=nv12|vaapi,hwupload`, `deinterlace_vaapi` when interlaced, `scale_vaapi=…:format=nv12`, `h264_vaapi -rc_mode CQP -qp 21 -g 1000`; GPU decoding first (`-hwaccel vaapi`, unless that codec and pixel format were seen to need CPU decoding); a run that fails before writing its init steps the stream down (GPU decoding → CPU decoding → software, never back up while the stream lives) and its next attempt (the usual retry) uses that step; `playback/hw_decode_unsupported` and `playback/hw_accel_failed` as in §10.3. The codecs and pixel formats seen to need CPU decoding are remembered for the compat streams (until the server restarts) apart from the playback sessions' memory of §10.3: the cost of not sharing it is one failed run per kind. Output: the copy's HLS options (`-hls_time 2`, 20 segments, `run-<n>.m3u8`, `init-<n>.mp4`, `seg-<n>-<00000>.m4s`) in the compat folder.
- **Transcode slot**: the compat stream takes one slot of `max_concurrent_transcodes` (§10.3) when it starts, counted with the playback sessions in `hls_transcode` (and counting against them), and gives it back when it stops or fails; its sessions take none of their own. A compat stream without viewers (in its idle delay) keeps its slot only until another transcode needs one: a compat stream starting, or a playback session starting a transcode, with no slot free stops the idle compat streams first, the one idle the longest first and only as many as needed (zapping across interlaced channels never runs out of slots). With no slot free once those are gone (the playback transcodes and the watched compat streams fill the limit, or the setting is `0`), a session that would start the compat stream is refused `playback/transcode_limit_reached` (503), before any `copy` is started for it.
- **Sessions**: `streamUrl` is the same capability URL (`…/live/index.m3u8`) for both renditions: the session's `rendition` picks the stream whose playlist and files it serves and whose availability its heartbeat checks.

**Timeshift in detail** (a replay window per stream, shared by its viewers: pausing or rewinding never touches the stream, the upstream or the other viewers):

- **Window**: `settings.live_window_minutes` (default 30, from 1 to 240; §15 "Playback"), read at each poll, so a change applies to the running streams. Each stream (`copy` and `compat` alike) keeps in memory the segments it appended, numbered across runs; its window is the newest of them totalling at most the setting (at least one). A stream's window starts empty: a viewer rewinds at most to when its stream started (its first viewer), never further.
- **Clock** (`#EXT-X-PROGRAM-DATE-TIME`, ISO 8601 UTC with milliseconds): the segments a run's poll lists for the first time get their start from the relay's clock at that poll, minus their durations (so the newest ends now), never before the end of the stream's previous segment; the next segments of the run start where the previous one ends. A restart leaves a gap in this clock (the time the upstream was lost): the segments before it stay in the window and playable.
- **Retention** (the server deletes, never ffmpeg): a segment leaving the window is deleted once it has been out of it for its duration plus 30 s (RFC 8216 §6.2.2 asks for the whole playlist's duration, which would double a 30-minute window's disk for players that reload the playlist every few seconds anyway); a finished run's init and playlist go once none of its segments is left, in the window or awaiting deletion. A stream that stops or fails deletes its folder as before.
- **Cache size**: `settings.live_cache_max_gb` (default 20, from 1 to 10,000; §15 "Playback"): the size of every stream's window, each segment measured when first listed (the segments awaiting deletion go within their grace, and are not counted). Above it, the oldest segment of all streams leaves its window, then the next oldest, until under the cap, never shortening a window below its newest 30 s; the `cache/disk_low` notification (§15) stays as it is.
- **From a point**: `index.m3u8?from=<sequence>` serves the window from that segment on (the whole window when the segment already left it, the newest segment alone when it is past the newest), so a player that cannot seek in a live playlist (`mpv`, §29.5) loads one starting where it wants, anchored there while the segment lasts. Anything but a non-negative integer is `common/validation_failed` (400).
- **Wire**: the playlist (about 900 segments for 30 minutes) is gzipped when the request accepts it (`Content-Encoding: gzip`, `Vary: Accept-Encoding`); segments are served as before.
- **Pause**: a paused viewer is still a viewer: its heartbeats keep its session and so its stream (and its provider connection). The player itself ends a session paused for as long as the window (§29.5), so a pause never holds a connection longer than the window could give back.
- **Disk**: about 0.45 to 1.8 GB per channel watched for 30 minutes (2 to 8 Mbit/s), plus a `compat` stream's; the cache cap above bounds the total.
- **Tests**: the window, retention and clock rules on the scripted relay (a paused viewer keeping its stream, a window longer than the old 30 s, a cap shortening the oldest window, a restart's gap with its older segments kept); with real ffmpeg, a stream whose served playlist outgrows 30 s with program dates, segments deleted once out of the window plus their grace, and a restart's discontinuity keeping the earlier segments listed and served.

**Live sessions in detail** (in memory: like streams, they end with the process):

- `POST /tv/channels/:id/sessions` `{ capabilities }` (§10.2, for the rendition choice above): an active profile is required; the channel must be enabled and present (else `tv/channel_not_found`). → 201 `{ sessionId, streamUrl, rendition, windowS }` (`windowS`: the replay window in seconds, timeshift below; absent from older servers). `streamUrl` is the capability URL `/api/v1/stream/<sessionId>/<secret>/live/index.m3u8` (§20: 256 random bits, only the hash kept, valid while the session is); its segments are `…/live/<file>`, relative to it; a file not (or no longer) in the stream's folder is `tv/segment_not_found` (404). A client that goes away before the answer (its request aborted) leaves no session: its viewer leaves the stream at once, so the stream holds no connection for it beyond the idle stop.
- `POST /tv/sessions/:id/heartbeat` (optional JSON body `{ paused?: boolean }`, anything else ignored, a `sendBeacon` body included) → 204; `paused: true` sets the session's `pausedSince` (kept by the next paused beats), any other beat clears it; `DELETE /tv/sessions/:id` → 204. Only by the session's account; an unknown, ended or foreign session is `tv/session_not_found` (404). A session without heartbeat for 60 s is ended by the next request that touches it or by the sweep (every 10 s); a heartbeat for a channel disabled or gone meanwhile ends the session (`tv/channel_not_found`).
- Ending a session publishes `playback.session_terminated` to its auth session (`admin`, `timeout` or `ended`), like a playback session. No progress; a `copy` session takes no transcode slot.
- Admin: `GET /admin/tv/sessions` → `{ items: [{ id, account: { id, name }, profile: { id, name, color }, channel: { id, name, number? }, rendition, device?, startedAt, lastHeartbeatAt, pausedSince? }] }`, newest first; `DELETE /admin/tv/sessions/:id` → 204. Admin → Sessions lists them with the playback sessions: the channel's name and number instead of a title, "Live" as the mode (and "Transcode" for `compat`), no position; a paused one shows "Paused since 21:04" (a paused viewer keeps its stream, and so a provider connection).
- Creating a session records when its channel was last watched (`tv_channels.watched_at`, for the snapshots' priority below).

**Channel snapshots** (a still of each channel, shown on the TV page's cards, §29.6; pure rules in `core/tv/snapshot-schedule.ts`, the free snapshots in `application/tv/stream-snapshots.ts`, the background grabs in `application/tv/snapshot-grabs.ts`, both components holding their state in memory; ffmpeg in `infrastructure/tv/live-snapshotter.ts`):

- **A snapshot**: one picture, WebP (`libwebp`, quality 70), 480 px wide with the source's aspect ratio (`scale=480:-2`), deinterlaced first (`bwdif=mode=send_frame:deint=interlaced`) when the channel's probe is interlaced (§29.4); stored at `/data/images/tv/snapshots/<channel id>.webp`, written to a temporary file then renamed over the previous one; `tv_channels.snapshot_at` is when it was taken. Deleted with its channel (a refresh's deletion, its source's deletion). Every snapshot ffmpeg runs at the lowest CPU priority, its arguments as an array, killed after 12 s, its output read whole into memory (a picture of a few tens of KB, refused past 2 MB).
- **From a running stream** (free: no provider connection, so taken whatever the source's setting below): while a channel's `copy` stream runs, a poll that lists new segments takes a snapshot when the channel's last one (or the last attempt from a stream) is 5 minutes old or more: the run's `init-<n>.mp4` then its newest segment, read from the stream's folder by the server, are piped to `ffmpeg -f mp4 -i pipe:0 -frames:v 1 -vf [bwdif,]scale=480:-2 -c:v libwebp -quality 70 -f webp pipe:1`, like the compat stream's input (never a path handed to ffmpeg). Never awaited by the relay; one at a time per channel and two at a time in all (a snapshot due while two run waits for the next poll). A failure (a file gone, ffmpeg's exit) is logged at debug level and leaves the snapshot as it was; the next try is 5 minutes later.
- **Background grabs** (channels not streaming): for each source whose snapshots are on (below), roughly every 15 minutes per enabled, present channel without a stream, within a strict budget, so that the provider never sees projo use its last free connection nor connect in bursts. A task (`tv-snapshots`, every 5 s) starts at most one grab per source when every rule holds:
  - **One at a time** per source.
  - **Budget**: fewer than the source's grabs per hour (`tv_sources.snapshot_grabs_per_hour`, default 60, from 1 to 600) started in the last 60 minutes.
  - **Spacing**: 10 s plus a random 0 to 5 s since the source's last connection opened (a grab's, or a stream's attempt).
  - **Never the last free connection**: a source without a limit always qualifies; else at least 2 of its `max_connections` free, counting its streams starting, running or retrying, its grab, and the stops under way still holding a connection (§29.4).
  - **Pause**: 3 consecutive refusals from the source (below) pause its grabs for 1 hour, logged as a warning with the source and the reason (`tv snapshot grabs paused`); a successful grab resets the count. The count and the pause are in memory (a restart forgets them).
  - **Due channel**: enabled, present, without a `copy` stream (it gives free snapshots), of a channel never snapshotted or whose snapshot is 15 minutes old or more; after a failed grab (`tv_channels.snapshot_attempt_at`, `snapshot_failures`: consecutive failures) not before 1 hour, after 2 failures 6 hours, after 3 or more 24 hours; a success resets the count.
  - **Priority** among the due channels: (1) those a TV page shows (the page's hint, below, kept 5 minutes), (2) any profile's favourites, (3) those watched in the last 7 days (`tv_channels.watched_at`), (4) the rest; within one, the stalest first (never snapshotted, then the oldest snapshot), then the page's order.
- **A grab**: ffmpeg with the relay's input options (§29.4: the protocol whitelist, the `User-Agent` and referrer, the 15 s socket timeouts, the cached probe's RTSP transport else TCP; the upstream from `upstreamOf`, its secrets masked), then `-skip_frame nokey` (only a keyframe is decoded) on the input, `-frames:v 1`, the filters and WebP output above, killed after 12 s. Its result: the picture (stored as above, `snapshot_at` and `snapshot_attempt_at` set, failures reset), or a failure with a fixed reason: `refused` (ffmpeg reports an HTTP 403, 429 or another 4xx than 400, 401 and 404 — a panel's 458 —, or an RTSP 453), `timeout` (killed at 12 s, or a socket timeout), `failed` (anything else: 401, 404, an unreadable stream, no picture). `refused` and `timeout` are the source's refusals (the pause above). A failure is logged with the channel, the upstream's host and the reason (masked like the relay's, §29.2), never a URL nor a secret.
- **A grab is a connection** of its source (§29.4, connection limit): a session needing a connection stops the source's grab first, before any idle stream; a session on the very channel being grabbed stops that grab. A stopped grab is a stop under way until its ffmpeg is gone (the new stream waits for it), records nothing on the channel (neither a failure nor an attempt) and does not count against the budget's pause. Stopped too: when its channel is disabled or gone, its source deleted or its snapshots turned off (at the next tick), and on shutdown (the module's `stop` waits for it).
- **Setting** (per source, the source's dialog, §29.6): "Channel snapshots" on or off, `tv_sources.snapshots`; unset, it is off when the source's `max_connections` is 1 and on otherwise (a Freebox, an M3U without a limit; an `xtream` source follows its account's limit until the admin sets it). Off, the source has no background grab; snapshots from its running streams are still taken (they cost no connection).
- **The page's hint**: `POST /tv/visible-channels` `{ channelIds }` (at most 200) → 204: the channels a TV page shows in its viewport, sent when they change (2 s after the last change) and every minute while the page is visible; kept 5 minutes per profile, ids not listed to the profile ignored. Nothing else depends on it.
- **Tests**: the schedule's rules (budget, spacing, never the last free connection, priority, back-off, the source's pause) beside `core/tv/snapshot-schedule.ts`; the connection plan with grabs (a viewer evicting a grab before an idle stream); the free snapshots' throttling on the scripted relay; with real ffmpeg, a snapshot from a running stream, a grab from the test provider's endless stream, and a failing grab whose logs hold no URL nor secret; the snapshot route and its access rule.

### 29.5 Player

The same player (§10.7), in a live mode of `@projo/player`: a `MediaState` without duration, and a timeline of the replay window instead (§29.4): real pause, ±10 s, a drag on the bar and a jump back to live. No speed, trickplay, segments, next episode, quality, audio or subtitle menu. Shown: the channel's logo and name, the programme on now with its elapsed part, the next one and its time. Previous / next channel (`PageUp` / `PageDown`, buttons) follows the page's order (favourites, then groups), and a channel list opens over the picture. Full screen, PiP and AirPlay follow `EngineCapabilities` as elsewhere. `html-video` plays the live playlist (hls.js, native HLS in Safari); `mpv` plays the `copy` playlist.

**Player in detail** (slice 1: no guide, no favourites, `copy` only):

- **Route**: `/watch/tv/:channelId`, outside the shell like `/watch/:itemId` (a player path: no reload nor update banner over it, §16.4). Exit goes back in history, else to `/tv`. Zapping replaces the URL (`replace`): Back leaves the player, never walks through the channels zapped.
- **Live controller** (`@projo/player`: `application/live-controller.ts`, pure rules in `core/live.ts`): `createLiveController({ channelId, engine, api, ends, timers, clock, storage, page })` → a store and its actions (`start`, `stop`, `zap`, `togglePlay`, `setVolume`, `toggleMute`, `seekBy`, `seekTo`, `goLive`, `restart`, `retryNetwork`, `sessionTerminated`) and `timeline()` (timeshift below); volume restored and remembered as in §10.7. Port `LiveTvApi`: `createSession(channelId, { capabilities })`, `heartbeat(sessionId, { paused })`, `endSession(sessionId)` (a `keepalive` request, also when the page goes away: `sendBeacon` cannot `DELETE`), `playlist(streamUrl)` (its text). No rate, track, segment or progress.
- **Engine**: `PlayerEngine.loadLive({ streamUrl, autoplay, from? }, onFailure, onOpened?)` plays a live playlist from its live edge (or from a point, timeshift below); returns what stops it, like `load`. Nothing a title left on the shared engine carries over: normal speed (the controller sets it too), no subtitle delay, subtitles or chosen audio track, no start position. Live, the player reads only `paused`, `waiting`, `ready`, volume and mute of the `MediaState`, and the position from `livePosition()`: duration and current time mean nothing there and are never shown, nor sent to the system's media controls. No startup watch nor decode fallback: the server gives a `browser` engine `compat` for what it does not decode (§29.4).
- **Session**: created with `engine.clientCapabilities()` once the tab's previous live sessions are ended, a dropped creation's included (a `SessionEnds` of its own, as §10.6: a source with one connection can zap: the old stream is then idle and stopped first, §29.4); a creation no longer wanted by the time its turn comes (zapped past, left) is never sent; heartbeat every 10 s; `DELETE` on zapping, on leaving and when the page goes away; a React remount keeps it, as a playback session, and adopts a creation under way. A session still being created when the page goes away is never ended by the player: it lives until the server's 60 s sweep (§29.4).
- **Pause** keeps the session and its heartbeat (timeshift below). Without timeshift (an older server, whose playlist has no program dates, or an engine without `liveSeek`), any play after a pause (the button, `space`, the system's media controls, Picture-in-Picture) reloads the stream: playback resumes at the live edge.
- **Failures**: a network failure (creating the session, or the stream: `StreamFailure.kind` `network`), a heartbeat answered `tv/session_not_found` and `playback.session_terminated` with `timeout` reconnect with a new session (1, 2, 4, 8, 15, 30 s, "Reconnecting…", as §10.7), then block. `playback.session_terminated` with `ended` for a session the player did not end reconnects too, once: the server ends a session whose stream failed or whose channel went just before answering with the code, and the new session's refusal shows that code; ended again before the new session plays, it shows "Session ended". A creation refused (`tv/stream_unavailable`, `tv/connection_limit_reached`, `tv/channel_not_found`…), a heartbeat answered `tv/stream_unavailable` or `tv/channel_not_found`, and a stream failure of kind `decode` or `other` block: the translated message, "Back" and "Retry" (a new session). `playback.session_terminated` with `admin` shows "Stopped by the administrator".
- **Zapping**: previous / next channel is the neighbour in the TV page's order (§29.6), wrapping at both ends. The old session ends (`DELETE`), then the new one is created; the chrome names the new channel at once, the picture shows the spinner until it plays. A zap during a creation drops it (that session is ended as soon as it answers); a zap clears a blocking error.
- **hls.js** (`html-video`): `liveSyncDuration` 6 s (playback starts and settles 6 s behind the live edge, like the playlist's `EXT-X-START`), no `liveMaxLatencyDuration` (it would pull any rewind back to the live edge), `maxLiveSyncPlaybackRate` 1 (no catch-up speed-up), `liveDurationInfinity` off (`seekable` is the window), `backBufferLength` 60 s, no `startPosition` (the live sync point); a fatal network error restarts loading at the live edge once before failing. Safari's native HLS gets the playlist URL at once (no keyframe wait: the session is answered once its stream is ready). `mpv`: `loadfile` with `start=none`; with timeshift, every load starts at a segment the controller chose (timeshift below), never a seek inside libmpv.
- **Interface** (`ui/LivePlayerPage.tsx`, the classes and components of the player): the frame, fading chrome, spinner, blocking overlay and controls of §10.7, the timeline and ±10 s those of timeshift (below), without speed, quality, languages, chapters, episodes, playback info, prompts or gestures beyond a tap (a tap shows or hides the controls; a click plays or pauses; a double click toggles full screen). Top: exit. Bottom row: play/pause, volume, then in the middle the channel's logo (when it has one), number and name; then previous channel, next channel, channel list, Picture-in-Picture, AirPlay and full screen (by `EngineCapabilities`). Over an engine that `rendersBehindPage`, as §10.7.
- **Channel list**: a panel over the picture, at the right (the bottom of the screen on phones), of fixed size and scrolling inside: the channels in page order under their group names, each with its logo, number and name, the current one marked and scrolled into view. Picking one zaps and closes it. It takes and holds focus like a player menu (`↑`/`↓` between channels, `Esc` closes it and gives focus back to its button).
- **Keys**: `space` and `K` play/pause, `PageUp` previous channel, `PageDown` next channel, `L` channel list, `↑`/`↓` volume, `M` mute, `F` full screen, `Esc` and the back keys as §10.7 (close the list, release focus, leave the page's full screen, exit); `←`/`→` back and forward 10 s with timeshift (as §10.7: on a focused button they move focus, on the focused bar they seek), else they only move focus between controls; `Enter` as §10.7. A gamepad's LB/RB are previous / next channel.
- **System media controls** (`AppHost.systemMedia`): the channel's name as title, "Live TV" as subtitle, its logo as artwork; actions play, pause and `nexttrack` (next channel); the play state on an empty timeline (no duration, no position).

**Player, guide and favourites** (guide slice):

- **Order**: zapping, wrapping and the channel list follow the TV page (§29.6): the favourites first, then each group's other channels; a channel comes once.
- **Guide**: in the bottom row, under the channel's number and name, the programme on now (its title, its start and end times, and a thin bar of its elapsed part), then the next one (its start time and title), each on one line, cut with an ellipsis; a channel without guide data shows its name alone. A row of the channel list shows the title on now under the name. The guide comes from `GET /tv/guide`, read when the player opens and every minute (§29.6); between two reads, a programme that ended gives way to the next one, and the elapsed bar moves every minute.
- **System media controls**: the title on now as subtitle when known, else "Live TV".

**Player, timeshift** (the replay window of §29.4):

- **When**: the engine's `EngineCapabilities.liveSeek` (`html-video` and `mpv` both) and a playlist with program dates (§29.4). Otherwise the player behaves as before (no bar, a play after a pause reloads at the live edge).
- **Window** (pure rules in `core/live.ts`): the controller reads the session's playlist (`LiveTvApi.playlist(streamUrl)`) once before loading the stream (5 s at most: past that the stream loads at its live edge, its bar shown once a read answers), then every 5 s while the session lasts, paused included, and parses its segments: sequence, start (from the program dates and durations), duration, the target duration. Its start is the oldest kept point, its *edge* the newest segment's end, carried forward with the clock between two reads (at most 15 s). Positions are wall-clock times: `PlayerEngine.livePosition()` is the time of the frame shown, `PlayerEngine.seekLive(point)` goes to a point (`{ atMs, sequence, segmentStartMs, live? }`: the time, the segment holding it and that segment's start; `live` for the live point), and `LiveLoad.from` starts a load at one.
- **Live point**: 6 s before the edge (hls.js's `liveSyncDuration` and the playlist's `EXT-X-START`). The player is *at live* within 6 s plus two target durations of the edge; behind, it shows how far behind the live point it is.
- **Seek**: ±10 s (buttons, `←`/`→`), a click or a drag on the bar, `Home` (the oldest point) and `End` (live) on the focused bar. A target is clamped to the window: no earlier than its start plus one target duration, and a target past the live point goes to the live point. A target in a restart's gap goes to the first segment after it. Seeking keeps the play state.
- **Pause** keeps the picture: play resumes where it stopped. If its point has left the window meanwhile, play resumes at the window's start plus the larger of three target durations and 10 s, with the notice "Resumed at the earliest point kept". A session paused for `windowS` (the session's, §29.4) is ended by the player (the stream may then stop and give its connection back): the controls stay as paused, and play creates a new session at the live point, with the notice "Paused too long: back to live". Heartbeats tell the server the pause (§29.4).
- **Engines**: `html-video` seeks inside its media element: with hls.js, a point maps to its fragment by the fragments' program dates (`frag.start` plus the offset into it), its position is `hls.playingDate`; native HLS (Safari) maps through `getStartDate()`; both seek to the live point by hls.js's `liveSyncPosition`, else the end of `seekable` minus 6 s. `mpv` never seeks in a live stream: every load and every seek loads `index.m3u8?from=<sequence>` with `demuxer-lavf-o=live_start_index=0` (ffmpeg's HLS demuxer starts at the playlist's first segment), the play state kept; its position is the segment's start plus `time-pos` (libmpv rebases each file to 0), approximate past a restart's gap.
- **Interface**: above the bottom row, as for a title (`player__bar`): the bar of the window (left the oldest kept point, right the live edge), the part played up to the position, the start of the programme on now and of the next one as ticks when they fall in the window, a restart's gap hatched; hovering or dragging shows the time of day there (and the programme's title when the guide knows it). At its right, the live badge: "LIVE" on red at the live point; behind it, grey with the delay ("−4:12"), a button back to live. In the bottom row, back 10 s and forward 10 s after play/pause (forward disabled at live). The notices show over the picture for 4 s, as the track toasts do.
- **Tests**: the pure rules (playlist parsing, clamps, live point, delay, resume point) beside `core/live.ts`; the controller against the fake engine (a pause keeps the position, play resumes there, a seek clamped, back to live, a pause longer than the window, the release after `windowS`, an older server without timeshift); the engines' mapping in pure files with their tests; e2e journey 6 pauses, rewinds 10 s and goes back to live.

### 29.6 Interface

- **Viewer**: a "TV" entry in the navigation, present only when the profile can see at least one enabled channel. The page: favourites first, then one section per group; each channel is a card (logo, number, name, now with its progress, next). A star on the card adds or removes a favourite. The guide data of the page is refreshed every minute without reloading the list.
- **Profiles**: a "Live TV" access switch per profile (default on), next to library access (§14); the maximum content rating does not apply to channels.
- **Admin → TV**: the sources as a table (name, kind, enabled / total channels, last refresh, state); a row opens the source's dialog: settings, "Refresh now", connection limit, groups and channels to enable (searchable, fixed height).
  - State of a source: *refreshing* (a `refresh_tv_source` queued or running), *error* (the last attempt failed: its translated code), *ready*, *pending* (never refreshed). The page follows `job.updated` of `refresh_tv_source` and `fetch_tv_logos`.
  - "Add a source": a dialog with the name, the kind (`m3u`, `xtream` shown "Xtream Codes", `freebox`), then its settings: for `m3u` the playlist URL, the XMLTV URL and `User-Agent` (both optional); for `xtream` the server URL, the username and the password (a password field); for `freebox` the box address, prefilled with `http://mafreebox.freebox.fr`. Every kind's fields take the room of the largest: the dialog keeps its size when the kind changes. The source's snapshot setting takes its default (§29.4). Saving creates the source, closes the dialog and queues its first refresh.
  - The source's dialog has two tabs at a fixed height, each scrolling inside. **Channels**: a search field over the channel names; without a search, the groups (switch, name, enabled / total), a group opening its channels (switch, logo, number, name) with a back arrow; with a search, the matching channels of every group. Lists are paged as they scroll. **Settings**: name, the kind's settings (`m3u`: playlist URL, XMLTV URL, `User-Agent`; `xtream`: server URL, username, password; `freebox`: box address), connection limit (empty = none; on an `xtream` source read-only, the account's), "Channel snapshots" (a switch, its default per §29.4) and under it the snapshots per hour (a number, disabled while the switch is off), save; "Refresh now" and "Delete" (confirmed). A secret field shows its masked value as placeholder (the username and password, never returned, a fixed `••••••••`), left empty it keeps the stored one.

**TV page in detail** (slice 1, without guide nor favourites):

- **Navigation**: "TV" after "Movies" in the shell's navigation, shown while `GET /tv/channels` lists at least one channel to the active profile (until the guide slice's access switch, every profile sees every enabled channel). The list is read with the shell (cached five minutes per profile) and again when the page opens.
- **Page** `/tv` (in the shell, not a kept tab): the title "TV", then one section per group in the API's order (§29.7), its name as heading ("Other channels" for the unnamed group), its channels as a grid of cards. A card: a 16:9 tile with the logo contained and centred (`mediaUrl()` of `logoUrl`), the name in its place when there is none; under it the number (when it has one) and the name, on one line. A card is a link to `/watch/tv/:channelId`. Loading: skeleton tiles; error: the translated error with "Retry"; no channel (reached by its URL): an empty state.

**TV page, guide and favourites** (guide slice):

- **Sections**: "Favourites" first, the profile's favourite channels in the order they were added; then one section per group with its channels that are not favourites. A channel appears once on the page, so the page's order is the zapping order and the channel list's (§29.5). A section left without channels is not shown.
- **Card**: the tile, with a star button in its top-right corner (`aria-pressed`, labelled "Add to favourites" / "Remove from favourites"; filled on a favourite and always shown; otherwise shown when the card is hovered or holds the focus, and always on touch screens); under the tile, the number and name, then the title on now over a thin bar of its elapsed part, then the next one's start time and title, each on one line. The two guide lines keep their space when empty: every card has the same height.
- **Favourites**: the star sends `PUT` or `DELETE /tv/channels/:id/favorite` and moves the card between sections at once, put back as it was if the request fails (with the translated error). Starring never opens the channel.
- **Guide refresh**: the page and the player read `GET /tv/guide` when they open, then every minute and when the window comes back to the foreground; it updates the cards' guide lines without reading the channel list again. Between two reads, a programme that ended gives way to the next, and the elapsed bars move every minute.
- **Navigation**: a profile without Live TV access lists no channel (§29.7), so it has no "TV" entry.

**TV page, "On now" and the programme detail** (richer guide slice):

- **On now** ("À la une"): at the top of the page, above the favourites, one row per programme kind (§29.3) of what is on now, titled "Movies on now", "Sport on now"… (`tv.onNow.<kind>`), in this order: `movie`, `series`, `sport`, `news`, `documentary`, `kids`, `entertainment`, `music`, `other`. A row holds the channels whose programme on now has its kind, and the channels without a programme on now whose own kind is not `other` (their name as title, no bar); in the page's order (favourites, then groups). A row without a channel is not shown, so a page without guide data and without a recognisable channel starts with its favourites as before. The favourites and the groups follow, as before: a channel shows in a row and in its section.
- **Row**: the home page's rows (§19: one line of cards, paged by arrows with a fine pointer, scrolled sideways with snap on touch screens), cards of the home's wide width. Rows follow the guide: they are recomputed at each read of `GET /tv/guide` and each minute, so a programme that ends moves its channel to its next programme's row.
- **On now card**: a 16:9 image (the card's image, below); the channel's logo small in the image's bottom-left corner on a glass chip (when the image is a snapshot or the programme's); an "Information" button (`i`) in its top-right corner opening the programme's detail, shown like the star of a channel card (always on touch screens). Under the image: the programme's title, then the channel's name and "until 21:40" (`tv.until`), each on one line, then a thin bar of its elapsed part. The card is a link playing the channel (`/watch/tv/:channelId`); a long press (touch) or the context menu (right click, the context-menu key) opens the detail too.
- **Channel card** (the sections): as before; a long press or the context menu opens the detail of its programme on now, when it has one.
- **Programme detail**: a dialog of fixed size whose body scrolls, read from `GET /tv/programmes/:id`: the image (16:9, when it has one), the title, the episode (`S2 E5`, else the on-screen text) and subtitle on one line, the start and end times with the day when it is not today, the kind and the channel's number and name, the description, then "Next" with the next programme's time and title. Footer: "Watch" (plays the channel; only for a programme on now, and absent in the player, which already plays it) and the channel's favourite star (`PUT` / `DELETE /tv/channels/:id/favorite`, as on the cards). Loading keeps the dialog's size (a skeleton); a programme gone meanwhile (`tv/programme_not_found`) shows the translated error.
- **Player** (§29.5, its bottom row): left of the programme's lines, the programme's image as a 16:9 thumbnail of the block's height (none without one, nor on a compact screen); the title on now, then the episode and subtitle (`S2 E5 · Subtitle`) in place of the times when it has some, the elapsed bar, and the next one, within the block's fixed height. The title on now is a button opening the detail (without "Watch").

**TV page, the guide grid** (guide grid slice):

- **Views**: a segmented control beside the page's title switches between "Featured" ("À la une": the "On now" rows, the favourites and the groups above) and "Guide" (the grid). The view is in the URL (`/tv?view=featured`, `/tv?view=guide`; switching replaces the entry); `/tv` alone opens the view last shown on this device (the browser's storage; "Featured" at first).
- **Layout**: the Guide view fills the window's height: the toolbar, then the grid, which scrolls inside both ways under its sticky time header and beside its sticky channel column; the page does not scroll. This is an exception to the page-scroll rule, like the logs and jobs tables, and it stays with this view. The grid keeps its size while loading, empty or filled: a row whose programmes are not read yet shows a skeleton band.
- **Time**: one continuous axis from the hour 6 hours before the page opened to the hour after 72 hours later (what the guide keeps, §29.3), at 5 px per minute (3 on a phone). The header marks every half hour with its time, and each midnight with the day's name; a vertical line marks now across the header and the rows, moved every minute. On opening, the grid shows now a quarter into its visible time.
- **Rows**: one per channel, in the page's order (favourites, then groups, §29.5), or the filter's. The channel cell: logo, number, name and the favourite star (as on the cards); on a phone the logo alone (its name when it has none). It is a link playing the channel.
- **Programmes**: a block from its start to its end (cut at the axis' ends): the title, then the episode (`S2 E5`, else the on-screen text) or else the start time, each on one line, cut with an ellipsis, the second line only when the block is tall and wide enough; the text stays in view while a long block is scrolled sideways. The programme on now stands out, ended ones are dimmed. A hole between programmes, and a channel without guide data, show a band "No programme". A block opens the programme's detail (above: "Watch" only for the one on now).
- **Toolbar** (one line, scrolling sideways on a phone): the day (a select: "Yesterday" when the axis starts then, "Today", "Tomorrow", then the weekday and date, in the viewer's time zone; picking one scrolls to its midnight, or to the axis' start; it names the day at the grid's left edge as the grid scrolls), "Now" (back to now as on opening), the channels (all, the favourites when the profile has some, then each group of the page: its channels, favourites included), the kind ("All programmes", then each programme kind of §29.3): programmes of another kind are dimmed, not hidden. A filter left without a channel (its last favourite removed) falls back to all.
- **Keyboard**: the grid is one Tab stop (`role="grid"`: rows, row headers, cells; roving focus, visible). `←` / `→` the previous / next block of the row (`←` from the axis' start, and `Home`, reach the channel cell), `↑` / `↓` the block at the same time in the row above or below (the time a sideways move last landed on, else now), `PageUp` / `PageDown` a screen of rows, `Enter` opens the block or plays the channel. The grid scrolls to show the focused cell.
- **Pointer and touch**: the grid scrolls with the wheel and trackpad both ways (`Shift` + wheel sideways), with touch both ways, and through its scrollbars.
- **Reading**: `GET /tv/schedule` (§29.7) by windows of 6 hours aligned on UTC and blocks of 50 channels in the API's order, only those holding the rows and hours in view and a margin around them; each answer is kept 5 minutes. Only the rows in view (and a few around) are drawn, and in them only the blocks in the visible time and a margin: hundreds of channels over 3 days stay smooth. Channels, favourites and groups come from `GET /tv/channels`, as for the Featured view.

**TV page, channel snapshots** (snapshot slice, §29.4):

- **The card's image** (`features/tv/card-image.ts`, one function for every card of the page): the channel's snapshot when it was taken less than 60 minutes ago, else the image of its programme on now, else its logo contained on a neutral fill, else its name. A picture that fails to load steps down to the next. "On now" cards and the sections' channel cards both show it in their 16:9 tile; over a snapshot or a programme's image, the channel's logo sits small in the bottom-left corner on a glass chip.
- **Fresh**: the snapshots come with the channel list and with each read of `GET /tv/guide` (every minute, §29.6), their URL changing with each new picture (`?v=`): a card's picture changes without reloading the page; a snapshot past 60 minutes (the page's clock, moving every minute) gives way to the next image.
- **Hint**: the page sends the channels whose cards are in its viewport (`POST /tv/visible-channels`, §29.4) 2 s after they change and every minute while it is visible, so the grabs start with what is on screen.
- The player's channel list keeps its logos.

**Admin → TV, guide matching** (richer guide slice): in the source's channel list, each channel row shows the guide channel its programmes come from (§29.3: its first display name, else its id; "Manual" beside the admin's choice; "No guide" when the last read matched none, "Automatic" before any read) as a button opening a picker dialog: a search field (over ids and display names, ignoring case and accents), "Automatic" first (clears the choice), then the source's guide channels of the last read (id and display names), paged as they scroll, the current one marked, fixed height. Picking saves at once (`PATCH /tv/channels/:id` `{ guideChannel }`) and queues the source's guide read. A source whose last read listed no guide channel shows "Automatic" alone.

**Live TV access in detail**:

- `profiles.live_tv` (boolean, on by default): `liveTv` in the profile's DTO (absent from older servers: on), in `POST /profiles`, `POST /admin/accounts/:id/profiles` and `PATCH /profiles/:id`. It is not a restriction in §14's sense: a profile with Live TV off is not *restricted* (its account actions and the admin stay as they were), and neither library access nor the maximum rating applies to channels.
- **Who changes it**: like library access, an admin acting from an unrestricted active profile, either way, on any profile; anyone else gets `profile/admin_only` for a value other than the profile's (sending the current value is no change). A new profile created by such an admin (`POST /profiles`, or from Admin → Accounts) is on unless asked otherwise; one created by anyone else takes its creator's active profile's value (without a resolved active profile: on only if every profile of the account has it) as default and ceiling: off may be asked, on beyond it is `profile/admin_only`.
- **Effect**: a profile without access lists no channel (`GET /tv/channels` and `GET /tv/guide` answer empty lists); the logo (except to an admin), live session and favourite routes answer `tv/channel_not_found` as for a channel that does not exist; a heartbeat ends the session with `tv/channel_not_found`. Turning access off ends the profile's live sessions at once (`playback.session_terminated` `ended`: the player tries once more and shows `tv/channel_not_found`). Its favourites are kept for when access comes back.
- **Web**: Admin → Accounts, a profile's card: a "Live TV" switch under the libraries it may see, saved with the card, no confirmation (the admin turns it back on as easily). Profile settings, "Access": "Live TV" with "Allowed" or "Not allowed", read-only like the libraries and the maximum rating, under "Set by an administrator."

### 29.7 API

Under `/api/v1`: `GET /tv/channels` (the profile's enabled channels with group, favourite flag, now and next), `GET /tv/guide` (now and next alone), `GET /tv/schedule` (the guide grid's programmes), `GET /tv/channels/:id/logo`, `GET /tv/channels/:id/snapshot`, `POST /tv/visible-channels`, `PUT` / `DELETE /tv/channels/:id/favorite`, `GET /tv/programmes/:id`, `GET /tv/programmes/:id/image`, `POST /tv/channels/:id/sessions`, `POST /tv/sessions/:id/heartbeat`, `DELETE /tv/sessions/:id`. Under `/api/v1/admin`: `GET` / `POST /tv/sources`, `GET` / `PATCH` / `DELETE /tv/sources/:id`, `POST /tv/sources/:id/refresh`, `GET /tv/sources/:id/channels`, `GET /tv/sources/:id/guide-channels`, `PATCH /tv/sources/:id/groups/:groupId`, `PATCH /tv/channels/:id` (`enabled`, `guideChannel`), `GET /tv/sessions`, `DELETE /tv/sessions/:id`. Error domain `tv` (`tv/source_not_found`, `tv/source_unreachable`, `tv/source_invalid`, `tv/account_refused` (the Xtream account is refused: credentials, expired, banned, disabled), `tv/group_not_found`, `tv/channel_not_found`, `tv/logo_unavailable` (internal, logged), `tv/connection_limit_reached`, `tv/stream_unavailable`, `tv/session_not_found`, `tv/segment_not_found`, `tv/guide_unreachable`, `tv/guide_invalid`, `tv/programme_not_found`, `tv/snapshot_unavailable`). Schemas in `packages/shared/api/tv.ts`. The desktop app's `minimumServerVersion` rises to the first server with these routes.

Admin shapes (slice 1):

- A source: `{ id, name, kind, settings, maxConnections?, channelCount, enabledChannelCount, state, lastRefreshAt?, lastAttemptAt?, lastError?: { code, message }, failureCount, createdAt }`; channel counts exclude missing channels. `GET /tv/sources/:id` adds `groups: [{ id, name, enabled, channelCount, enabledChannelCount }]` (`name` empty for the unnamed group).
- `settings` of an `m3u` source: `{ kind: 'm3u', playlistUrl, guideUrl?, userAgent? }`. In every answer each URL is masked to `<scheme>://<host>[:port]/…` (no user info, path or query); `userAgent` is returned as it is. `POST` takes them in clear; `PATCH` takes `{ name?, settings?, maxConnections? }` where an absent URL keeps the stored one and `guideUrl: ''` removes it, `userAgent: ''` removes it, `maxConnections: ''` removes the limit. Changing the playlist URL or `User-Agent` queues a refresh.
- `settings` of an `xtream` source: `{ kind: 'xtream', serverUrl }` in every answer (the origin of the server URL; the username and password never). `POST` takes `{ kind: 'xtream', serverUrl, username, password }`; `PATCH` takes `{ kind: 'xtream', serverUrl?, username?, password? }` where an absent field keeps the stored value and an empty one is refused (nothing wipes a credential by accident); changing any of them queues a refresh; `maxConnections` on an `xtream` source, in a `POST` as in a `PATCH`, is `tv/source_invalid` (422; the account's, §29.2).
- `settings` of a `freebox` source: `{ kind: 'freebox', address }`, returned as it is (no secret). `POST` takes the address (§29.2); `PATCH` takes `{ kind: 'freebox', address? }`, and changing the address queues a refresh. A `PATCH` whose `kind` is not the source's is `tv/source_invalid`.
- `POST /tv/sources/:id/refresh` → 202 `{ jobId }`. `DELETE /tv/sources/:id` → 204 (its channels, groups, logos and favourites go with it).
- `GET /tv/sources/:id/channels?q=&groupId=&cursor=&limit=` → `{ items: [{ id, name, number?, groupId, enabled, hasLogo }], nextCursor?, total }` in playlist order; `q` matches names ignoring case and accents.
- `PATCH /tv/sources/:id/groups/:groupId` `{ enabled }` → the group; `PATCH /tv/channels/:id` `{ enabled }` → the channel.
- `GET /tv/channels/:id/logo` (a media route: media key accepted, §20) serves the logo of an enabled channel (of any channel to an admin), else `tv/channel_not_found`; `Cache-Control: private, max-age=3600`.

Viewer shapes (slice 1; the live sessions are in §29.4):

- `GET /tv/channels` → `{ groups: [{ id, name }], items: [{ id, name, number?, groupId, logoUrl?, favorite?, now?, next? }] }`: every enabled, present channel (to every profile until the guide slice brings the per-profile switch), ordered by source name, then group and channel position; `logoUrl` is `/api/v1/tv/channels/:id/logo` when a logo is stored; `groups` are those of the listed channels, in the same order (`name` empty for an unnamed group). `favorite` and `now` / `next` (`{ title, startAt, endAt }`) stay absent until the guide slice.

Viewer shapes (guide slice; an active profile is required by each, and a profile without Live TV access sees no channel, §29.6):

- `GET /tv/channels` adds to each item `favorite` (always set) and `now` / `next` when known (§29.3), and `favorites`: the ids of the profile's favourite listed channels, in the order they were added.
- `GET /tv/guide` → `{ items: [{ channelId, now?, next? }] }`: now and next of each listed channel that has one of them, the lightweight read the page and the player repeat every minute.
- `PUT /tv/channels/:id/favorite` → 204: adds the channel last among the profile's favourites (already one: unchanged, it keeps its place). `DELETE /tv/channels/:id/favorite` → 204 (not a favourite: 204 too). The channel must be listed to the profile, else `tv/channel_not_found`. Favourites go with their channel or profile.

Shapes of the richer guide (additive: older clients read what they read before; an active profile is required by each, and a profile without Live TV access sees no channel nor programme, §29.6):

- A programme (`now`, `next` of `GET /tv/channels` and `GET /tv/guide`) adds `id`, `kind` (§29.3), `subtitle?`, `episode?: { season?, episode?, label? }` (numbers from 1; `label` the on-screen text, given only without numbers) and `imageUrl?` (`/api/v1/tv/programmes/:id/image`, when its image is stored). A channel of `GET /tv/channels` adds `kind`, the channel's own kind (§29.3). `GET /tv/guide` is the "On now" read: the page builds its rows from it.
- `GET /tv/programmes/:id` → `{ id, channelId, title, subtitle?, description?, episode?, kind, categories, startAt, endAt, imageUrl?, next? }`: a programme of a channel listed to the profile (§29.6) that has not ended more than 6 hours ago; `categories` the guide's texts (in the server's language first, at most 3), `next` the channel's programme that follows it (a programme as above). Else `tv/programme_not_found` (404).
- `GET /tv/programmes/:id/image` (a media route: media key accepted, §20): the stored image of such a programme (of any present channel's to an admin), else `tv/programme_not_found`; `Cache-Control: private, max-age=3600`.

Shapes of the guide grid (§29.6; additive):

- `GET /tv/schedule?from=&to=&channels=` → `{ items: [{ channelId, programmes: [{ id, title, startAt, endAt, kind, episode? }] }] }`: the programmes that overlap `[from, to)` (starting before `to`, ending after `from`) of the channels among `channels` (comma-separated ids, 1 to 100) that the profile sees (§29.6: an unknown, disabled, missing or hidden channel is left out, never an error); channels in the order asked (each once), each channel's programmes by start, a channel without programme there left out; nothing without Live TV access. `from` and `to` are ISO dates, `from` before `to`, at most 24 hours apart; else 400 `common/validation_failed`. No subtitle, description, categories nor image: the grid opens the detail for them.

Shapes of the channel snapshots (additive; §29.4):

- A channel of `GET /tv/channels`, and an item of `GET /tv/guide`, add `snapshot?: { url, takenAt }` when the channel's snapshot was taken less than 60 minutes ago: `url` is `/api/v1/tv/channels/:id/snapshot?v=<takenAt in ms>` (a new picture, a new URL). `GET /tv/guide` lists a channel with a snapshot even without now or next.
- `GET /tv/channels/:id/snapshot` (a media route: media key accepted, §20; `v` ignored) serves the snapshot (`image/webp`) of a channel listed to the profile (of any present channel to an admin), else `tv/channel_not_found`, as the logo; `Cache-Control: private, max-age=86400` (the URL changes with the picture).
- `POST /tv/visible-channels` `{ channelIds: string[] }` (at most 200, an active profile required) → 204: the page's hint (§29.4).
- Admin: a source adds `snapshots: boolean` (the effective setting, its default applied) and `snapshotGrabsPerHour: number`; `POST` and `PATCH /tv/sources[/:id]` take `snapshots?: boolean` (`PATCH` also `null`: back to the default) and `snapshotGrabsPerHour?: number` (1 to 600).
- Error code `tv/snapshot_unavailable` (internal, logged: a snapshot not taken) joins the domain.

Admin shapes (richer guide slice):

- A channel of `GET /tv/sources/:id/channels` adds `guideChannel?: { id, name?, manual }`: the admin's choice (`manual: true`), else the guide channel the last read matched (`manual: false`), absent when none; `name` its first display name when the last read listed it; and `guideMatched?`: `false` when the last read matched no guide channel to it, `true` when it did, absent before any read.
- `GET /tv/sources/:id/guide-channels?q=&cursor=&limit=` → `{ items: [{ id, names }], nextCursor?, total }`: the guide channels of the source's last read, in the guide's order; `q` matches an id or a display name ignoring case and accents.
- `PATCH /tv/channels/:id` takes `{ enabled?, guideChannel? }` (at least one): `guideChannel` a guide channel id (any id: the next read applies it, even one the last read did not list) or `''` for "Automatic"; changing it queues the source's `refresh_tv_guide`. → the channel.
- Error code `tv/programme_not_found` joins the domain.

### 29.8 Tests

Never a real provider. `test/support/iptv-server.ts` replays `test/fixtures/iptv/` (an M3U, an XMLTV, the Xtream `player_api.php` answers with panel quirks (numbers as strings, `null`s, empty guide ids, a radio, a VOD entry), its `xmltv.php` and `/live/<user>/<pass>/<id>.ts`, the Freebox TV API answers: `api_version`, `tv/channels`, the `freeboxtv` bouquet and `epg/by_time`, trimmed from a real box) and serves an endless MPEG-TS made by ffmpeg, progressive, interlaced and HEVC. Unit: the M3U and XMLTV parsers, channel identity across refreshes, the connection limit, the rendition choice, the compat stream on fakes (sharing, holding the copy, slots). Integration: refresh and guide jobs on SQLite, the relay with real ffmpeg (start, sharing one upstream between two viewers, stop, restart on failure; `compat` of the interlaced and HEVC variants decoded as progressive H.264 with AAC, one upstream connection, its slot given back after the idle stop). E2E (journey 6): the admin adds an M3U source and enables a group, a profile opens TV and plays a channel.

### 29.9 Order

Milestone M8 (§23), one slice at a time; each slice's details are completed here before its code.

### 29.10 What it does not do

- **Later, when a version is specified here**: the provider's VOD and series (as catalogue items identified through TMDB), Xtream replay, the mobile app, the choice of the audio track, teletext and DVB subtitles.
- **Not planned**: recording, rewinding the live further than its replay window or before its stream started, tuners (DVB, HDHomeRun), radios, any bundled or suggested playlist.
