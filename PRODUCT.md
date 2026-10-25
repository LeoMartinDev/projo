# projo — Product specification

> A self-hosted media server for movies and TV shows, built for a household, with the user experience as its only differentiator.
> This document bounds the project: anything not in it is not in projo. It is written to be carried out from A to Z by a developer or an agent, milestone by milestone.

Document version: 1.0 (2026-10-23). Product language: French first, English shipped.

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
- Untyped multi-folder libraries, messy content accepted, automatic per-file classification.
- Robust scanning: detection of files being written, missing files, unreachable folders, moves, multiple versions.
- Playback: direct play, remux, audio transcoding, software video transcoding with a quality picker, text and burned-in subtitles, timeline thumbnails.
- Smart audio and subtitle selection, remembered per show.
- Intros and credits: skip intro, skip end credits, next episode autoplay, through community databases, local fingerprinting and manual markers.
- Per-profile progress: continue watching, up next, watched / unwatched, My list, video preview on the home hero.
- Accounts with login, invitations, up to 5 profiles per account with a PIN, per-profile library access and maximum content rating.
- Full administration: first-launch wizard, libraries, queues, accounts, active sessions, playback settings, metadata editing, jobs, notifications.
- Application updates from the admin page, without redeploying the container, with rollback.
- French and English interface, dark theme.

### 2.2 Planned for v2 (not in v1, but the architecture must not make it impossible)

- Mobile app (same API, bearer tokens already planned).
- Network mounts (NFS, SMB): the per-root watcher / polling strategy is already planned.
- Hardware transcoding acceleration (VAAPI, QuickSync) behind an admin option.
- HDR to SDR tone mapping.
- Faithful rendering of ASS subtitles (libass in WASM).
- Subtitle download (OpenSubtitles).
- Advanced kids mode (dedicated interface, exit lock); the per-profile maximum rating is already in v1.
- Light theme.
- Per-profile watch history.
- Absolute numbering for anime and dated episodes.
- Outgoing webhooks for alerts, qBittorrent and Radarr/Sonarr integrations.
- TMDB collections, person pages, trailers.
- Playing extras (trailers, making-of).

### 2.3 Permanently out of scope

- Multi-tenancy, billing, cloud account, relay, native HTTPS, certificate management.
- Chromecast, AirPlay, native TV apps (Apple TV, Android TV, Tizen, webOS).
- Music, photos, live TV, books, unidentifiable home videos.
- Renaming, moving or deleting files by the app. The library is read-only.
- NFO files and local images (`poster.jpg`, `fanart.jpg`).
- Disc folders (`VIDEO_TS`, `BDMV`), ISO images, 3D files.
- Offline mode, download for offline playback.
- Connecting one client to several servers.

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
    web/               # React application
      src/
        features/      # home, browse, item, player, profiles, settings, admin, auth
        shared/        # components, hooks, API client, i18n
  packages/
    shared/            # Result, error codes, Zod schemas, naming conventions, API types
  runtime/             # Dockerfile, supervisor, image scripts
  design/              # the reference design (provided by Léo), visual source of truth
  e2e/                 # Playwright
  PRODUCT.md
  README.md
```

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

Codes are stable `domain/reason` strings, declared in `packages/shared/errors.ts`, shared with the web for message translation. Each use case declares the exact union of codes it can produce: `ScanLibraryError = AppError<'library/not_found' | 'library/root_unreachable' | 'library/scan_already_running'>`. A single table in `entrypoints/http/error-mapping.ts` maps each code to an HTTP status; a code missing from the table is a bug and gives 500.

**On the web**: same bans (classes, `null`), same `Result` for API calls, same error codes for messages. Organised by feature, no layers: the front end has no domain to protect.

**Validation at the boundaries.** Every HTTP input, every job payload, every external API response goes through a Zod schema before entering `application`.

### 5.4 Data on disk and configuration

A single volume, mounted on `/data`:

```
/data/
  db/projo.db                 # SQLite (+ WAL)
  db/backups/                 # copies before migration
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
  logs/                       # optional, stdout remains the main output
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
| `playback_sessions` | `id`, `profile_id`, `session_id` (auth), `source_id`, `item_id`, `mode` (`direct` \| `hls_remux` \| `hls_transcode`), `quality?`, `audio_stream?`, `audio_delivery?` (`copy` \| `aac`: the remux audio decision, kept to survive a restart), `subtitle_stream?`, `burn_in` (bool), `started_at`, `last_heartbeat_at`, `position_ms`, `ended_at?` |
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
- The `hint` steers the classifier: `movies` forces the movie classification for any file whose name has no explicit episode pattern; `series` forces episode; `auto` lets it decide.
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
5. **Ready.** `state = ready`, `ready_at = now`, the source moves on to classification. A `pending` source is retested at each cycle. After 24 h in `pending` (configurable), an admin notification `scan/source_stuck_pending` is emitted, once per source.

Documented recommendations for the host (README): enable the `.!qB` extension for incomplete files in qBittorrent, and let Radarr/Sonarr import finished files (atomic arrival). In both cases the quarantine is nearly instant.

A `ready` source whose size or mtime changes again (file replaced by an upgrade) goes back to `pending`, becomes invisible again, and keeps its `item_id`: when leaving quarantine, if probing and parsing give the same result, it takes its place back without re-matching.

### 7.4 Scan triggers

Three triggers, a single scan per library at a time, concurrent requests coalesce into a single follow-up run.

| Trigger | When | Scope |
|---|---|---|
| Watcher | Recursive `fs.watch` on each root, if `watch_enabled` | Queues the touched paths and moves the next incremental scan to "now + 5 s" (debounce). Never authoritative on its own. |
| Periodic incremental | Every `scan_interval_minutes` (default 15) | Walks the folders; only goes down into those whose mtime changed since the last scan or that are unknown. Compares the files found with the `sources` table. |
| Manual | Admin button per library: "Scan" (incremental) or "Full scan" (read everything again, names included, reclassified if the parser changed, re-probe sources whose signature changed, retry matching of `unmatched` ones) | |
| Startup | When the server starts | Incremental scan of all libraries, after 10 s |

The watcher can be turned off per library, and will be off by default on network mounts in v2 (detected by FS type).

### 7.5 Deletions, missing files, unreachable roots

- Source absent during a scan: `state = missing`, `missing_since = now`. The item becomes invisible immediately if it has no `ready` source left. Nothing else is deleted: progress, My list, preferences, manual corrections, images remain.
- A `missing` source that reappears at the same path: back to `ready` (or `pending` if size or mtime changed), without loss.
- Automatic purge of `missing` sources after 30 days (configurable) by the `purge_missing` job; manual purge possible in the admin, per source or in bulk. The purge deletes the source; the item is deleted if it has no source and no manual correction left, otherwise it stays (invisible).
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
- the library hint contradicts the name pattern (`hint_conflict`).

In "To review", the admin can: search a TMDB title and assign it (movie, or show + season + episode), declare "it's a movie" / "it's an episode of…", or hide the source. Each correction is saved in `manual_matches` and takes precedence over automatic matching on all later scans.

A `needs_review` file stays visible and playable (under its local item, title taken from the name) until it is corrected.

**Hiding a file** ("To review", "Pending files"): `state = rejected`, the source leaves its items (an item left without a file becomes invisible) and every list; scans never bring it back, full scans included, nor a move (its name is still read again, without ever sending it back to "To review"). "Hidden" lists these files; "Show again" (`POST /admin/sources/:id/restore`, 409 `source/not_rejected` for a source not hidden) reads its name again, puts it back in `pending` and probes it at once, then the matching runs as for a new file (a correction remembered in `manual_matches` applies again, a name to review goes back to "To review"). A hidden file gone from the disk stays in "Hidden"; shown again, the next scan marks it missing.

On a title page, the admin has "Fix the match": same search, same memory. Reassigned sources leave the old item; if it has no source left it becomes invisible, and its per-profile rows (progress, My list, track preferences, markers) move to the new item (episode by episode by number; those of the season and the show when they have no file left). An old item that keeps another file keeps its history.

Correcting a show is atomic: all episodes are first checked with TMDB, then everything is written in one transaction; episodes missing from the new show become `needs_review` (`episode_not_found`) instead of failing the whole thing, and the response lists them (`needsReview`).

---

## 8. Naming conventions table

projo accepts the union of the Jellyfin and Infuse conventions, minus what is out of scope. The app never renames or moves anything. Each row of this table is a parser test case with a fixture tree in `apps/server/test/fixtures/naming/`.

### 8.1 Movies

| Case | Accepted | Example |
|---|---|---|
| Flat file | yes | `Movies/Inception (2010).mkv` |
| Folder per movie | yes, the file may have a different name from the folder | `Movies/Inception (2010)/Inception.2010.1080p.BluRay.x264-GRP.mkv` |
| Year | first `19xx` or `20xx` preceded by a delimiter (`space . _ - ( ) [ ]`), not followed by digits or a date; everything after it is dropped | `Inception.2010.1080p` → title `Inception`, year 2010 |
| Without year | yes, matching on the title alone with a stricter threshold | `Inception.mkv` |
| Release name cleanup | cuts at the first token of the Jellyfin list (`1080p 720p 2160p 4k x264 x265 h264 h265 hevc bluray bdrip brrip web-dl webrip hdtv dvdrip proper repack multi subs unrated extended limited internal remux …`) plus the French tokens `vostfr vff vfq vfi vf2 truefrench french multi`; removes a leading `[group]`, and any `[...]` after the title, even before the year (`Avatar [FR-EN] (2009)`); dots and underscores become spaces | `[GRP] Le.Fabuleux.Destin.d'Amélie.Poulain.2001.FRENCH.1080p.mkv` → `Le Fabuleux Destin d'Amélie Poulain`, 2001 |
| Id tag | `tmdbid`, `tmdb`, `imdbid`, `imdb`, `tvdbid`, `tvdb`, between `[]`, `()` or `{}`, separator `-` or `=`, on the folder or the file. An IMDb or TVDB id is resolved to a TMDB id through `/find`. A tag skips the search. | `Inception (2010) [tmdbid-27205].mkv`, `Inception {imdb-tt1375666}.mkv` |
| Edition | `{edition-Label}` (Plex, Infuse, Radarr), kept as is (`editionName`), or one of the Infuse labels recognised alone after a separator, stored as an id (`editionIds`, web label `editions.<id>`): `Director's Cut` → `directors_cut`, `Extended Cut`, `Extended Edition` or `Extended Collector's Edition` → `extended`, `Theatrical Cut` → `theatrical`, `Final Cut` → `final_cut`, `Unrated Cut` → `unrated`, `Uncut` → `uncut`, `Special Edition` → `special_edition`, `Ultimate Edition` → `ultimate_edition`, `IMAX` → `imax`, `Remastered` → `remastered` | `Blade Runner (1982) {edition-Final Cut}.mkv`, `Blade Runner (1982) - Director's Cut.mkv` |
| Multiple versions | by TMDB identity: any file matching the same movie is a version, wherever it is | `Dune (2021) - 2160p.mkv` + `Dune (2021) - 1080p.mkv` |
| Parts | `cd`, `dvd`, `part`, `pt`, `disc`, `disk` followed by a number or a letter `a-d`, optional separator, in the same folder | `Movie-cd1.mkv`, `Movie (2010) - part a.mkv` |
| `VIDEO_TS`, `BDMV`, `.iso`, `.disc` stubs, 3D | no: ignored, admin notification `scan/unsupported_layout` once per folder | |

### 8.2 Shows

| Case | Accepted | Example |
|---|---|---|
| Show folder | recommended: `Name (year) [tmdbid-id]`, year and tag optional | `Shows/Breaking Bad (2008) [tmdbid-1396]/` |
| Season folder | `Season 01`, `Season 1`, `S01`, `Saison 1`, `Staffel 1`, `Temporada 1`, `Stagione 1`, `Series 1`, Jellyfin's multilingual keywords, a purely numeric folder `01`, with an optional title after the number | `Saison 2 - La fuite/` |
| Specials | `Season 00`, `Season 0`, `Specials`. **Not** `Extras` (that is an extras folder, §8.5) | |
| Episode patterns | `S01E02` with optional ` . _ -` separators between S and E, `s1e2`, `S01.E02`, `S01xE02`, `1x02`, `se1.ep2`, `season1.episode2`, `Season 1 Episode 2`, `S03 E09`, `Episode 02` or `02 - Title` or `02.Title` under a season folder, `01.02 Title` (season.episode) under a show folder | `Dexter.S04E02.Remains.to.Be.Seen.HDTV.mkv` |
| Episode without a season folder, in the show folder | yes; season read from the name, otherwise 1 | `Fleabag/Fleabag S02E01.mkv` |
| Flat episode at the root | yes; show name = what precedes the pattern, cleaned like a movie title | `Misc/The.Bear.S03E01.1080p.WEB.mkv` → show `The Bear` |
| Multi-episodes | `S01E01-E02`, `S01E01E02`, `S01E01-02`, `1x01-1x02`, `Episode 16-17`; the end number is rejected if followed by digits or `p`/`i` (avoids `S09E14-1080p`) or if lower than the start number | |
| Absolute numbering | patterns `Name - 101`, `[Group] Name - 12 [1080p]`, `Name 101` detected; if the show has only one season on TMDB, assigned; otherwise `needs_review` (`absolute_numbering`). True absolute mapping: v2 | |
| Dated episode | `2017.04.20`, `2017-04-20`, `20.04.2017` detected, `needs_review` (`date_based`). Support: v2 | |
| Safeguard | a season between 200 and 1927 or beyond 2500 is invalid (avoids `1920x1080` read as S1920E1080); an `NxNN` preceded by a channel layout and whose number is a codec (264 to 266) is not an episode, nor is `H.264`/`H.265` an absolute numbering | `Furiosa.2024.DDP5.1x265-GRP.mkv` → movie |
| Versions of an episode | by TMDB identity, like movies | `S01E01 - 1080p.mkv` + `S01E01 - 2160p.mkv` |
| Miniseries | season 1 | |

Classification (`auto`): an episode pattern (§8.2 "Episode patterns" row) in the file name or a season folder above = `episode`. An episode number placed before the pattern changes nothing: the pattern wins. Otherwise `movie`. Absolute numbering cases without a show folder are `unknown`.

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

- Single source. API key embedded in the code (like Jellyfin), replaceable in the admin (`settings.tmdb_api_key`).
- Metadata language at server level (`settings.metadata_language`, default `fr-FR`), overridable per library, field-by-field `en-US` fallback if the overview or the title is missing (a generic episode name, `Épisode 7`, counts as missing; still generic after the fallback, the episode has no title of its own, §6.3). Images requested with `include_image_language=<lang>,en,null`. Rating (`content_rating`) read from `release_dates` (movies) and `content_ratings` (shows) for the library's `rating_country`, US fallback; its country is stored with it (`content_rating_country`) and the profiles' maximum rating filter compares it on **that** country's scale (a fallback `PG-13` in a French library is judged on the US scale, a title present in two libraries of different countries keeps a single rating). Seasons and episodes inherit from the show. The API sends the official code as is, with its country and the §14 age tier it falls in (`contentRating: { code, country, tier }` of `packages/shared/api/content-ratings.ts`; tier = the lowest profile ceiling that lets it through, `R` → 18, absent outside the scale like `NR`); the badge shown is composed by the web (§13.5).
- **Item in several libraries**: the language and rating country of a movie or a show, seasons and episodes included, are those of the **oldest library** (`created_at`, then `id`) that contains a file of the movie or show (episodes included), whatever the library of the file being identified (`infrastructure/sqlite/item-library.ts`). A file identified in another library first writes with its own library's settings; if they are not those of the deciding library, the movie or show is refreshed (§9.4). Same rule at each write and at each change of the deciding library (file from an older library, library or root deletion, purge of missing files, correction or rejection of a file): a tree with mixed settings is refreshed entirely (§9.4).
- **Genres**: a fixed list of projo ids (`genreIds` of `packages/shared/api/genres.ts`: `action`, `adventure`, `animation`, `comedy`, `crime`, `documentary`, `drama`, `family`, `fantasy`, `history`, `horror`, `kids`, `music`, `mystery`, `news`, `politics`, `reality`, `romance`, `science_fiction`, `soap`, `talk`, `thriller`, `tv_movie`, `war`, `western`), the only thing stored. TMDB genre ids are converted to them (`core/metadata/genres.ts`); combined show genres are split: `10759` Action & Adventure → `action` + `adventure`, `10765` Sci-Fi & Fantasy → `science_fiction` + `fantasy`, `10768` War & Politics → `war` + `politics`. TMDB order, without duplicates; an unknown TMDB id is ignored and logged. The displayed name comes from the web locales (`genres.<id>`), in the interface language: a TMDB genre name is never stored. Seasons and episodes receive their show's genres.
- Dedicated HTTP client in `infrastructure/tmdb/`: concurrency 4, honours `Retry-After` on 429, 10 min in-memory cache of search responses, 10 s timeouts, every response validated by Zod.
- Images downloaded during enrichment, never hotlinked: posters `w500`, backdrops `w1280`, logos `w500` (PNG kept), episode stills `w300`, cast photos `w185`. Stored in `/data/images/<kind>/<id>.<ext>`, served by `/api/v1/images/<id>` with `Cache-Control: immutable` (the id changes if the image changes).
- Cast: first 20 actors + directors + writers, displayed, not clickable.

### 9.2 Matching

First of all: if a `manual_matches` row exists for the file (its source, then library + relative path, then signature), it applies, even if the original source was purged in the meantime.

**Movie**:
1. Id tag present → `/movie/{id}` (or `/find` for IMDb/TVDB). Done.
2. `/search/movie?query=<title>&year=<year>&language=<lang>`; as long as no candidate is acceptable or ambiguous (step 4), retry without the year, then with the title before the first `-` or `:`. Candidates from all searches are ranked together (`BAC Nord (2020)`: the search with 2020 only returns unrelated titles, the movie is from 2021).
3. Score per candidate: similarity of the normalised title (lower case, no accents, no punctuation) with `title` and `original_title` (max of the two), bonus for the exact year, penalty for year ±1, penalty for a different year, popularity bonus as a tie-breaker.
4. Accepted if the best score is above the threshold **and** beats the second by a margin; otherwise `needs_review` (`ambiguous_match` or `no_match`). Without a year in the name, the threshold is higher.
   - No title close enough: the alternative titles (`/alternative_titles`, all countries) of the 3 best candidates enter the max of step 3, then the choice is made again (`Star Wars Episode VI Return of the Jedi` is an alternative title of `Return of the Jedi`).
   - Candidates too close for the margin: the one with the best similarity and at least 10 times more TMDB votes (`vote_count`, at least 50) than each of the others is accepted (`What If...?`, 4,755 votes, against `WHAT / IF`, 187).
   - Year off by one: a candidate with the exact title at ±1 year, with at least 10 times more votes (and at least 50) than each exact-title candidate of the exact year, wins over them (`Split (2016)`: the 2017 movie, 18,767 votes, against three 2016 `Split`s with fewer than 60 votes).

**Episode**:
1. Resolve the show: id tag on the show folder or the file, otherwise `/search/tv?query=<show>&first_air_date_year=<year if present>`, same scoring. The show result is cached by normalised name for the whole scan.
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

A browser does not play the MKV container, nor AC3/EAC3/DTS/TrueHD audio (Safari plays AC3/EAC3), nor HEVC without hardware decoding, nor bitmap subtitles. Most of a household's files are MKVs. The server must therefore always be able to remux and transcode audio, and to transcode video when needed.

### 10.2 Choosing the playback mode

At every playback start, the client sends its **capabilities**: the result of `MediaSource.isTypeSupported` and `navigator.mediaCapabilities.decodingInfo` for a fixed list of codecs (`avc1`, `hvc1`/`hev1`, `av01`, `vp09`, `mp4a.40.2`, `ec-3`, `ac-3`, `opus`, `flac`), plus the screen height. The server chooses:

| Condition | Mode |
|---|---|
| `mp4`/`m4v`/`mov`/`webm` container **and** supported video codec **and** supported audio codec for the chosen track **and** no burn-in | `direct`: the file is served over progressive HTTP with `Range`, the browser plays it natively |
| Supported video codec, but unplayable container or unsupported audio | `hls_remux`: video copied (`-c:v copy`), audio copied if it is AAC, or AC-3 or E-AC-3 supported by the client, otherwise transcoded to stereo AAC 192 kb/s (Opus and FLAC are always transcoded: unreliable in HLS fMP4 on Safari) |
| Unsupported video codec, or lower quality requested, or subtitle burn-in | `hls_transcode`: video as H.264 (`libx264`, preset `veryfast`, CRF 21 for "Original", target bitrates per quality), audio as AAC |

Qualities offered in the player: Original, 1080p (8 Mb/s), 720p (4 Mb/s), 480p (1.5 Mb/s). "Original" in transcode mode keeps the source resolution. Multichannel audio is downmixed to stereo by default (`settings.audio_downmix = stereo | keep`).

Changing the audio track, burned-in subtitles, quality or version starts a new playback session at the current position.

A quality above the source is brought down to the best offered one (never upscaling); `availableQualities` = Original + the qualities ≤ the source height (16:9 equivalent height: a 1920×800 is 1080p). Without HLS on the client, a file that must be transcoded gives `playback/mode_unsupported` (`playback/transcode_unavailable` no longer exists). An HEVC tagged `hev1` (probe: `codec_tag_string`) does not go `direct`: Safari only plays `hvc1`, `hls_remux` retags it.

### 10.3 HLS pipeline

- An HLS session = a `/data/cache/transcode/<session_id>/` folder, an `index.m3u8` playlist, fMP4 segments (`init.mp4`, `seg-00042.m4s`), one ffmpeg process at a time.
- 4 s segments in transcode mode (`-force_key_frames expr:gte(t,n_forced*4)`), which allows a complete playlist computed in advance from the video stream duration (the container's if the probe does not have it: an audio track longer than the video would leave a last segment without picture, never produced).
- In remux mode, cuts can only fall on the source's keyframes: a **keyframe index** (timestamps) is extracted once per source (cache `/data/cache/keyframes/<source>.json`): from an MKV's `Cues` when they list all keyframes of the single video track (checked block by block on three cluster stretches, at a quarter, half and three quarters; a few tens of MB read at most instead of the whole file, decisive on a network share), otherwise with `ffprobe -select_streams v:0 -show_entries packet=pts_time,flags`, which reads the whole file. It runs at first playback if it does not exist yet (interactive job, high priority) and as a background job after enrichment. The playlist is computed from this index (segments of 3 to 8 s, bounded by keyframes).
- The playlist is served complete from the start (`#EXT-X-PLAYLIST-TYPE:VOD`), which gives a complete playback bar and immediate seeking. A request for a segment not yet produced and outside the current production window (current segment + 3) kills ffmpeg and restarts it at the requested segment's keyframe (`-ss <t> -copyts -start_number <n>`).
- A requested segment not yet written is awaited up to 20 s before 503, only if it is coming in the current run; a segment already passed (deleted behind the player) restarts ffmpeg. Only the latest segment request can restart ffmpeg, a request abandoned by the client stops, and a run that finished without producing the requested segment gives an error (no restart).
- End of session (explicit stop, or 60 s without heartbeat): ffmpeg killed, folder deleted after a 5 min grace period. The `cleanup_cache` job caps `cache/transcode` at `settings.transcode_cache_max_gb` (default 10) by deleting the oldest finished sessions.
- Maximum number of simultaneous transcodes: `settings.max_concurrent_transcodes` (default 2, configurable without a ceiling). Remuxing does not count. Beyond it: error `playback/transcode_limit_reached`, the player shows "Too many playbacks running on the server". Also not counted: sessions without heartbeat for 60 s, and the most recent one of the same authentication session on the same item (the player replacing its session, whether it stops the old one before or after); only one is exempted, other tabs of the same browser on the same title count. `0` disables transcoding.
- Hardware acceleration: not in v1. The admin option `settings.hw_accel = off | vaapi | qsv` exists in the schema from v1 but is not exposed; the ffmpeg command is built by a pure function that accepts this parameter, so that v2 only touches infrastructure.
- On Safari (iOS, macOS), HLS is played natively; elsewhere through hls.js.

### 10.4 Subtitles

| Type | Handling |
|---|---|
| External text (`srt`, `ass`, `ssa`, `vtt`) | converted to WebVTT by ffmpeg on first request, cache `/data/cache/subtitles/<source>/<n>.vtt`, served as a `<track>` of the player, whatever the mode. ASS styling is lost (v2: libass). |
| Embedded text (`subrip`, `ass`, `webvtt`, `mov_text`) | extracted by ffmpeg (`-map 0:s:<n>`) as WebVTT, same cache, same `<track>` |
| Bitmap (`hdmv_pgs_subtitle`, `dvd_subtitle`, external `sup`, `sub`/`idx`) | **burn-in**: `hls_transcode` mode forced with an `overlay`/`subtitles` filter; the player shows "Burned-in subtitles, reduced quality". Can be turned off: `settings.burn_in_enabled` (default true); if off, these tracks are listed greyed out as "not supported". A bitmap track picked by the cascade (§11.2, not explicitly requested) that cannot be burned in (transcode limit reached, client without HLS) is left aside: the session starts without subtitles rather than failing. |

Subtitle delay and size: adjustable in the player, remembered per device.

Cache: `<track>.vtt` (`source_subtitles` id) next to `<track>.json` (size and mtime of the converted file: the external one, or the video for an embedded one); converted again when it changes, concurrent conversions of a track shared. An external file not in UTF-8 (BOM, otherwise invalid UTF-8 ⇒ Windows-1252, a superset of Latin-1) is re-encoded to UTF-8 before ffmpeg. Access: the active profile (last profile of the auth session for `<track>`) sees the source (same rule as `listReadySources`), otherwise 404 `playback/subtitle_not_found`; bitmap ⇒ 422 `playback/subtitle_unsupported`. `pre_extract_subtitles`: `extract_subtitles` job (priority 15) on `source.ready`, all embedded text tracks in one ffmpeg pass.

### 10.5 Timeline thumbnails (trickplay)

`trickplay` job per source, low priority, after enrichment, one at a time, if `trickplay_enabled` on the library: `ffmpeg -vf fps=1/10,scale=320:-2,tile=10x10` → JPEG sprites + JSON index (`{interval, width, height, columns, sheets[]}`) in `/data/cache/trickplay/<source>/`. The player shows them when hovering the bar if they exist, otherwise nothing. Can be turned off (`settings.trickplay_enabled`). Deleted with the source.

Implementation: queued on `source.ready` (priority 10: runs after matching and images); decoding keyframes only (`-skip_frame nokey`), `fps=1/10:round=up` (a file shorter than 10 s gets one thumbnail); `source.json` (the source's size and mtime in the database) invalidates the sprites of a replaced file; the session's `trickplayUrl` is only set for up-to-date sprites; ready sources without up-to-date sprites are queued 2 min after startup then every day (`trickplay-backfill` task), those of an item a profile is watching at priority 12 (the resume frame of "Continue watching"). Routes: same access control as subtitles, 404 `playback/trickplay_not_found`. `trickplay` and `preview_clip` jobs wait (`isRunnable`) while an `hls_transcode` runs on a server with fewer than 4 cores (§18).

### 10.6 Playback sessions and progress

- `POST /playback/sessions` with item, optional source, capabilities, wanted tracks, quality → mode, stream URL, resolved tracks, known segments, resume position.
- Heartbeat every 10 s and on every pause, seek, track change and close (`navigator.sendBeacon`): current position. The server writes `playback_progress`.
- End: `DELETE`. Without heartbeat for 60 s the session is considered ended.
- The admin sees active sessions (profile, item, mode, quality, position, device) and can stop one: the player receives `playback/session_terminated` over SSE and shows "Playback stopped by the administrator". `/admin/sessions` page (profile, title and "S2 · E4", mode, quality, burn-in, version, position, device, "Stop"), refreshed every 5 s; a session without heartbeat for 60 s no longer appears; `DELETE` of an already ended session ⇒ 404.

### 10.7 Player

Home-made component on top of `<video>` and hls.js, no Video.js. Matches the `Player` and `PlayerNext` artboards: full-frame video, top (exit) and bottom chrome fading out after 3 s without movement, playback bar with visible segment zones, buffer, trickplay on hover and remaining time, then the row of controls: play/pause, −10 s, +10 s, volume, title and "S2 · E4 “Title”" in the middle, next episode, episode list, subtitles and audio menu, full screen. Quality, version, speed (0.5× to 2×), Picture-in-Picture, subtitle delay and size, and the file's chapters live in the subtitles and audio menu (tabs). A chapter with the muxer's default name (`Chapter 01`, `Chapitre 3`, `07`) arrives without a title (filtered at the API output, the stored `probe` is intact): the player shows "Chapter 3" from its position, in the menu as in the bar preview. "Skip intro" at the bottom right with its 8 s bar, "Intro skipped · Undo" toast at the bottom left. At the end, the "Next episode" screen shrinks the video to a thumbnail with "Enlarge and watch the credits", shows the next episode (number, runtime, title, overview, cast, direction, writing, music) and the "Next episode" (with countdown) and "Watch the credits" buttons.

Shortcuts: `space` play/pause, `←`/`→` ±10 s, `↑`/`↓` volume, `M` mute, `F` full screen, `S` skip the current segment, `N` next episode, `C` subtitles on/off, `Esc` exit. Mobile: double tap left/right ±10 s, vertical swipe for volume. Volume remembered per device (`localStorage`).

States to handle explicitly: initial loading, buffering, network error (automatic resume at the position), transcode limit reached, session stopped by the admin, end of the item without a next one (back to the title page after 5 s).

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

A change of audio or subtitle track (turning them off included) writes `track_preferences` for the show (or the movie) and shows an "Applied to the whole show" toast with the actions "Set as default for my profile" (which updates the profile settings) and "Undo". A change never modifies the profile defaults without that explicit action. API: `PUT /items/:id/track-preferences` (`:id` = movie or episode, stored on the movie or the show; languages normalised to ISO 639-1), "Undo" = `DELETE /items/:id/track-preferences` (204, idempotent); "Set as default" = `PATCH /profiles/:id` (`audioLanguage`, `subtitleLanguage`, `subtitleMode`).

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
- On entering `credits` (or on fallback): "Next episode" card with a 10 s countdown and the preview of the next episode. `auto_skip_credits` brings the countdown down to 0 (immediate playback). `autoplay_next = false` shows the card without a countdown. A movie has no next item: the card offers "Back to the title page".
- `preview` segment (preview of the next episode at the end of the file): treated like `credits` for triggering "next".
- Marking "watched": at 93 % of the duration **or** on entering `credits`, whichever comes first.

### 12.5 Manual markers and contribution

On an episode or a movie, the admin sets or adjusts one segment per type with two time fields and a preview, and "Apply to the whole season". Manual markers are exported in the backup like everything else.

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
| Continue watching | movies and episodes **in progress** (position between 2 % and 93 %), sorted by `last_played_at` descending, 20 max |
| Up next | for each started show without an episode in progress: the first **unwatched** episode after the last watched one (airing order, missing episodes skipped), otherwise the show's first unwatched episode; never an already watched episode (rewatching E1 after E1–E3 offers the first unwatched one after E1). Same rule for the hero and the show page's "Play"; "New episode" badge if its file arrived after the show was last played; sorted by last activity on the show, 20 max |
| Leaving these rows | movie watched; show whose present episodes are all watched; "Remove" action (`hidden_from_continue` on the item or the show, reset on the next playback) |
| Mark watched / unwatched | manual on movie, episode, season, show; "unwatched" resets the position to 0 |

### 13.2 Navigation

Matches the `Home` artboard: a pill navigation **Home · Shows · Movies · My list**, a **Search** button (icon, opens search as an overlay, `/` shortcut), and the profile avatar (menu: switch profile, profile settings, account and devices, administration if admin role, sign out). On mobile (`MobileHome`): bottom bar Home · Shows · Movies · My list · Search, avatar at the top.

### 13.3 Home

This is the screen that matters: 90 % of usage. Matches the `Home` artboard. Fixed rows, in this order, an empty row is omitted:

1. **Hero**: the most recent item of Continue watching or Up next, failing that a recent addition the profile has not removed ("Remove", `hidden_from_continue`). Full-screen backdrop, the title's TMDB logo (text if absent), metadata line (type and season, year, rating, genres), short overview, "Play"/"Resume S2 · E4", "More info", My list buttons. **Video preview**: on desktop, after 2 s without interaction, a clip of the item plays in a loop, muted, over the backdrop, with a "Turn on preview sound" button; the clip is produced by the `preview_clip` job (20 s from 25 % of the duration, 720p H.264 AAC, about 3 MB, cache `/data/cache/previews/<item>.mp4`); without a ready clip, the hero stays static; never a preview on mobile nor with `prefers-reduced-motion`. `GET /home` carries `hero.previewUrl` (`/api/v1/previews/:itemId.mp4`, with `Range`) when the clip of the movie or show is ready, made from the current version of the file and visible to the profile; otherwise it is requested (at most every 6 h per item), as for Continue watching and Up next items without a clip. Desktop = fine pointer and window wider than 640 px; "without interaction" = no click, no key, no scroll.
2. **Continue watching**: 16:9 cards (the §10.5 timeline thumbnail at the resume position when sprites exist, otherwise still or backdrop; `resumeFrame` of `GET /home`), progress bar, "S2 · E4 “Title”", "18 min left".
3. **Up next**: 16:9 cards, next episode of each started show, "New episode" badge.
4. **Recently added**: 2:3 posters, movies and shows mixed, sorted by `added_at` (a show moves up when a new episode becomes ready), "See all ›" link to Movies or Shows sorted by addition.
5. **My list**: 16:9 cards, "See all ›" link to the My list page.
6. **Categories**: below the fixed rows, rows of 2:3 posters mixing movies and shows, one per category: **Anime** (`animation` genre and Japanese original language, rule of §11.1), then one per genre (§9.1), titled with the genre label; the Animation row excludes anime. A category only appears with at least 6 titles visible to the profile; Anime first, then genres by descending number of visible titles (order of the §9.1 ids on ties), 12 rows at most. Each row: 20 titles at most, by descending `added_at`, watched titles (watched movie, show whose present episodes are all watched) last. Loaded in batches of 4 rows (`GET /home/categories`): the first arrives with the home page, the next ones when nearing the bottom of the page, the space of the awaited batch reserved by row skeletons; after the last batch, no more requests. "See all ›" of a genre row: Movies or Shows depending on the row's majority type (like Recently added), filtered on that genre and sorted by addition, the other remembered filters reset; Anime has none (no filter expresses it, Animation is not Anime).

Each card, on hover or focus, reveals its actions: Play, More info, Add to / Remove from My list (on an episode card of Continue watching or Up next: its show's My list), Mark as watched; the preview also shows the genres and the best quality ("4K HDR"), and for a show "Show · 2 seasons · 2023 – 2025". On mobile, a long press opens a sheet with the same actions. No personalisation, no recommendation, no "trending": categories only depend on the profile's visible catalogue (§14).

### 13.4 Movies and Shows

Poster grid, virtualised scrolling, sorting (addition, title, year, score) and filters (genre, by §9.1 id, labels sorted in the interface language; year or decade bounded by the years present in the profile's catalogue, watched / unwatched / in progress), in a "Filters" panel on mobile. State persisted per profile and per device. **My list** is a page of the same kind, sorted by date added to the list.

### 13.5 Title pages

- **Movie**: backdrop, logo or title, year, runtime, rating, TMDB score, genres, overview, "Play" or "Resume at 1:12", My list, Mark watched, versions (if several), available tracks (audio and subtitle languages), cast, and for the admin, in a discreet "⋮" menu at the end of the actions (never as a button of the row): Fix the match, Edit, Refresh, Markers.
- **Show** (`Series` and `MobileSeries` artboards): at the top "Resume S2 · E4" (or "Play" on the first unwatched episode), "My list", "From the beginning", rating and best available quality ("4K HDR") badges, years, number of seasons, genres, cast and creator. Then season tabs, "x of n watched" counter and "12 / 22 episodes" when files are missing, "Mark all as watched" button, and the episode list: number, 16:9 still with progress bar, title, runtime, overview, "In progress · 18 min left", "Watched" check mark. Bulk actions: mark the season or the show watched / unwatched.
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
- **Restricted profile** (selected libraries or maximum rating): it performs no account-level action, 403 `profile/restricted`: revoking sessions or devices, creating a bearer token, changing the password, creating, editing or deleting another profile, setting or removing a PIN (its own included). It edits its own settings unrelated to access (name, colour, languages, subtitles, autoplay…) and can restrict its access further, never widen it. The web hides "Account and devices" and profile management for it. **Without a resolved active profile** (`X-Profile-Id` refused: PIN not unlocked, foreign or unknown profile; "Who's watching?" not answered yet), the account acts as its most restricted profile: never any widening, and account actions are refused as soon as one of its profiles is restricted. Widening access requires an admin acting from a resolved active profile without restrictions.
- **Sessions**: `projo_session` cookie, httpOnly, `Secure` if the request is over HTTPS (direct or through `TRUST_PROXY`), `SameSite=Lax`, sliding 30-day lifetime, renewed on each request more than 24 h after the previous one. Same table for the bearer tokens (`Authorization: Bearer`) meant for the mobile app, created by `POST /auth/tokens` with a device name. Users see their devices (name, browser, last activity) and revoke them; the admin can revoke all sessions of an account.
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
| **To review** | `needs_review` sources: path, reason, what the parser understood, built-in TMDB search, assignment, "it's a movie", "it's an episode of…", hide (§7.8). The counter (menu, title) is the `total` returned by `GET /admin/sources`. |
| **Missing** | `missing` sources: path, since when, attached item. Purge one or all. |
| **Hidden** | `rejected` sources (§7.8): path, size. Action: show again. |
| **Accounts** | `AdminAccounts` artboard. List of accounts with their profiles (avatar, account role, summary "Movies, Shows · 16 and over", last activity and device, playing or not). Detail panel per profile: name, colour, accessible libraries, maximum rating, autoplay episodes, skip intros, protect with a PIN code, "Delete the profile". Per account: role, pending invitations, create an invitation, reset a password, disable, delete, revoke sessions, add a profile (5 max). List as a table; an account's details (settings + profiles) open in a dialog when clicking its row. |
| **Active sessions** | Who watches what, mode (direct, remux, transcode), quality, device, position. Stop a session. |
| **Playback** | Max simultaneous transcodes, audio downmix, subtitle burn-in, max transcoding cache size, trickplay on/off, (v2: hardware acceleration). |
| **Intros and credits** | Enabled providers and order, TheIntroDB key, fingerprinting on/off and thresholds, contribution on/off. |
| **Metadata** | Language, TMDB key (replacement; state `missing` \| `valid` \| `rejected` — `rejected` when TMDB answered 401 to the saved key since it was validated, also reported by the admin banner), "Refresh the whole library". |
| **Updates** | Current version, last check, available version and release notes, "Check now", "Update", versions on disk with "Go back to this version", update log. |
| **Server** | Name, port shown (read-only), `TRUST_PROXY` shown, data folder and space used per category, export the database. |
| **Jobs** | List of queued, running, failed jobs (type, target, state, attempts, error with code and context), retry, cancel. Target: name of the library, the file or the version; an item or a season arrives in parts (own title, show, numbers) and the web composes the line (`Severance · S2 · E4`, `Severance · Season 2`). No log viewer. |
| **Notifications** | Notification centre: unread, read, resolved. Badge in the menu. |

Notifications emitted in v1: `library/root_unreachable`, `scan/source_stuck_pending`, `scan/unsupported_layout`, `scan/needs_review_count` (daily if > 0), `metadata/tmdb_key_missing`, `update/available`, `update/runtime_too_old`, `update/failed`, `update/rolled_back`, `job/failed` (after the last attempt), `tmdb/unauthorized`, `cache/disk_low` (less than 2 GB free on `/data`). Reference list: `notificationKinds` of `packages/shared/api/notifications.ts`.

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
3. Exit code **75** = "switch requested": the supervisor reads `/data/app/pending` (the version, `1.4.0`, installed in `versions/<v>`), backs up the database (`db/backups/projo-<old>.db`), points `current` to the requested version, restarts, and waits for `/health` OK for 60 s. If OK: the old version becomes `previous`, at most the last 2 are kept, success logged. Otherwise: `current` pointed back to the old one, database restored from the backup, restart. In both cases it deletes `pending` and writes `/data/app/switch-result.json` (`{ fromVersion, toVersion, outcome: "switched" | "rolled_back", at, reason? }`); the supervisor never writes to the database (its schema belongs to the app versions): the app reads this file on startup, deletes it, and derives from it `app_versions` (`failed` for the refused version), the pending `update_runs` row and the `update/rolled_back` notification.
4. Migrations are run by the server on startup (Drizzle migrate, each migration in a transaction). A migration failure makes the server exit with a non-zero code: rollback through point 3.

### 16.4 Application side

- Daily `check_updates` job (and button): `GET https://api.github.com/repos/LeoMartinDev/projo/releases/latest`, compares with the current semver, checks `runtimeMin` against the runtime version (exposed by the supervisor through a `PROJO_RUNTIME_VERSION` environment variable). If the runtime is too old: `update/runtime_too_old` notification with the `docker pull` command to run, no "Update" button.
- "Update": `apply_update` job: download into `staging/<v>`, check of `SHA256SUMS` then of each manifest file, extraction into `versions/<v>`, writing `pending`, exit 75. The player of users in direct play is not affected; HLS sessions are interrupted and resume automatically (client reconnection, resume at the position).
- "Go back to this version": same mechanism with a version already present.
- `stable` channel only in v1 (`settings.update_channel` exists for v2).
- In development (`bun run dev`), the updater is disabled.

---

## 17. API

### 17.1 Conventions

- `/api/v1` prefix, JSON, shared Zod schemas (`packages/shared/api/`), typed client `hc<AppType>`.
- Authentication: session cookie or `Authorization: Bearer`. The active profile is sent in the `X-Profile-Id` header and checked as belonging to the account.
- Errors: `{ error: { code, message, context? } }` with the status from the mapping table. Cursor pagination (`?cursor=&limit=`), filters in the query.
- SSE: `GET /api/v1/events` (events: `scan.progress`, `scan.finished`, `source.ready`, `job.updated`, `notification.created`, `playback.session_terminated`, `update.state`, `catalog.changed`), filtered by audience: `admin` (including `scan.*` and `source.ready`), `everyone`, or only the session concerned. The audience is re-read at each event: an admin demoted or switched to a restricted profile (the stream's profile is the session's last profile) no longer receives admin events, a disabled account or a revoked session loses the stream. `catalog.changed` (audience `everyone`, no details): the catalogue changed (source ready, scan finished, `match_source` or `fetch_images` job finished), grouped on the server (at most one every 2 s, at the end of a burst); the web then reloads its catalogue queries (Movies, Shows, Home, title pages), at most every 1.5 s. `scan.progress` carries `phase` (`discovering` \| `processing`) and `total` when known, for a determinate bar. The admin follows the analysis (§15) by reloading the libraries on `source.ready` and on the end of `watch_pending` / `probe_source` jobs (`job.updated`), at most every 2 s.
- Everything admin is under `/api/v1/admin/` and requires the role.

### 17.2 Endpoints

| Domain | Endpoints |
|---|---|
| Setup | `GET /setup/status`, `POST /setup` |
| Auth | `POST /auth/login`, `POST /auth/logout`, `GET /auth/me`, `POST /auth/tokens`, `GET /auth/sessions`, `DELETE /auth/sessions/:id`, `POST /auth/password`, `GET /invitations/:token`, `POST /invitations/:token/accept` |
| Profiles | `GET/POST /profiles`, `PATCH/DELETE /profiles/:id`, `POST /profiles/:id/verify-pin`, `POST /profiles/:id/select` |
| Catalogue | `GET /home`, `GET /home/categories?cursor=` (a batch of §13.3 category rows, `total` and `nextCursor`), `GET /movies`, `GET /series`, `GET /items/:id`, `GET /items/:id/children`, `GET /search?q=`, `GET /images/:id`, `GET /genres` (ids of the genres present, unsorted, and year bounds `years: { min, max }`) |
| Progress | `PUT /items/:id/progress`, `POST /items/:id/watched`, `DELETE /items/:id/watched`, `POST /items/:id/hide-from-continue`, `GET/POST/DELETE /watchlist/:itemId` |
| Playback | `POST /playback/sessions`, `PUT /playback/sessions/:id/heartbeat`, `DELETE /playback/sessions/:id`, `GET /stream/:sessionId/index.m3u8`, `GET /stream/:sessionId/:segment`, `GET /stream/direct/:sourceId`, `GET /subtitles/:sourceId/:trackId.vtt`, `GET /trickplay/:sourceId/index.json`, `GET /trickplay/:sourceId/:sheet.jpg`, `GET /previews/:itemId.mp4`, `GET /items/:id/segments`, `PUT/DELETE /items/:id/track-preferences` |
| Admin libraries | `GET/POST /admin/libraries`, `GET/PATCH/DELETE /admin/libraries/:id`, `POST /admin/libraries/:id/scan`, `GET /admin/libraries/:id/scans`, `GET/PUT /admin/libraries/:id/profiles` ("Profiles with access", same `library_access` / `profile_libraries` as the profile), `GET /admin/fs/browse?path=` |
| Admin sources | `GET /admin/sources?libraryId=&state=&matchState=` (with `total` on every page), `POST /admin/sources/:id/recheck`, `POST /admin/sources/:id/assign`, `POST /admin/sources/:id/reject` (hide), `POST /admin/sources/:id/restore` (show again), `DELETE /admin/sources/:id`, `POST /admin/sources/purge-missing` |
| Admin items | `GET /admin/tmdb/search`, `POST /admin/items/:id/rematch`, `GET /admin/items/:id` (values and locked fields, for editing), `PATCH /admin/items/:id` (overrides), `POST /admin/libraries/:id/refresh-metadata` ("Refresh the whole library"), `DELETE /admin/items/:id/overrides/:field`, `POST /admin/items/:id/refresh`, `GET /admin/items/:id/images/alternatives`, `POST /admin/items/:id/images`, `PUT/DELETE /admin/items/:id/segments/:type`, `POST /admin/items/:id/segments/apply-to-season` |
| Admin accounts | `GET/POST /admin/accounts`, `PATCH/DELETE /admin/accounts/:id`, `POST /admin/accounts/:id/reset-password`, `POST /admin/accounts/:id/revoke-sessions`, `POST /admin/accounts/:id/profiles`, `GET/POST/DELETE /admin/invitations` |
| Admin operations | `GET /admin/playback/sessions`, `DELETE /admin/playback/sessions/:id`, `GET/PATCH /admin/settings`, `GET /admin/jobs`, `POST /admin/jobs/:id/retry`, `POST /admin/jobs/:id/cancel`, `GET /admin/notifications`, `POST /admin/notifications/:id/read`, `GET /admin/updates`, `POST /admin/updates/check`, `POST /admin/updates/apply`, `POST /admin/updates/rollback`, `GET /admin/stats`, `POST /admin/db/export` |
| System | `GET /health` (outside the prefix, no auth: `{ status, version, runtime }`) |

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
| `preview_clip` | after the enrichment of a movie or a show (most recent episode), and when an item enters Continue watching or Up next without a clip | 10 | 1 (heavy ffmpeg) | per item |
| `extract_subtitles` | end of probing of a source of a `pre_extract_subtitles` library | 15 | 1 | per source |
| `refresh_metadata` | weekly (shows in production), manual, language or country changed (§9.4, prio 10) | 20 | 1 | per item |
| `check_updates` | daily, manual | 50 | 1 | singleton |
| `apply_update` | admin | 100 | 1 | singleton |
| `cleanup_cache` | hourly | 20 | 1 | singleton |
| `purge_missing` | daily | 20 | 1 | singleton |

Rules: derived files (subtitles, trickplay, previews) of deleted sources, tracks and items are erased by the hourly `media-assets-cleanup` task. "Heavy ffmpeg" jobs (`fingerprint_season`, `trickplay`, `preview_clip`) do not run while a transcode is active and the server has fewer than 4 cores; they resume afterwards. Attempts: 3 with exponential backoff, except `apply_update` (1). Each job publishes `progress` and an SSE event. A job that fails on its last attempt creates a notification with the error code. The hourly `purge-jobs` task deletes `done` jobs 7 days after they finish and `failed` / `cancelled` ones after 30 days; `queued` and `running` jobs are never purged.

---

## 19. Interface, i18n, design

- **Reference design**: the design canvas copied in `design/artboards/` (seventeen artboards including the UI kit and the onboarding; inventory, tokens and components in `design/README.md`). It is the source of truth for layout, typography, colours, components and motion. Nothing is invented outside of it; a screen missing from the design (admin beyond the three drawn screens, settings, movie player, search) is built with the same components and tokens, and what is missing is asked for, not improvised.
- **Tokens** (extracted from the artboards): Geist font (Geist Mono for paths and sizes in the admin); background `#0A0A0B`, surfaces `#111113` and `#141416`, glass `rgba(255,255,255,.06 to .16)` with `backdrop-filter: blur`, text `#F4F4F5`, secondary text `#A1A1AA`, dimmed `#8B8B94` and `#71717A`, borders `rgba(255,255,255,.08 to .28)`; default accent `#F4F4F5` with variants `#7C83FF`, `#FF5A5F`, `#3DDC97`; error `#FF5A5F`; avatar colours Blue `#5B7FA6`, Terracotta `#A86A55`, Sage `#5E8C72`, Purple `#7D6AA6`, Honey `#B08A3E`, Slate `#5F6670`; radii 999 px (pills), 14 px (primary buttons), 12 px (cards), 10 px (thumbnails), 30 px (avatars); motion `cubic-bezier(.2,.7,.2,1)`, 0.8 s staggered fade-rise entrance, 26 s Ken Burns on backdrops, all turned off by `prefers-reduced-motion`.
- **Principles** when the design does not decide: dark, image first, few words, subtle motion, a single gesture for the main action.
- **Image formats**: 2:3 posters for Recently added, the home categories, Movies and Shows; 16:9 thumbnails with still for episodes, Continue watching, Up next and My list; backdrop + logo for the hero.
- **i18n** from the first screen: all strings in `apps/web/src/shared/i18n/<locale>.json`, including notification titles (`admin.notifications.<kind>`), genre (`genres.<id>`, §9.1) and edition (`editions.<id>`, §8.1) labels, the version label (§7.7), that of seasons, episodes and chapters without a name of their own (`item.season`, `item.specials`, `item.episodeNumber`, `player.menu.chapterNumber`, §6.3, §10.7), the rating badge (`contentRatings.*`, §13.5), the reason of an unreachable root (`admin.rootError.<reason>`, §7.5): the server only sends codes and ids, `fr` and `en` shipped, language per profile (default: browser language). API error codes are translated on the web. Localised dates and durations.
- **Theme**: dark only in v1, CSS variables ready for a light theme.
- **PWA**: manifest, icons, `display: standalone`, service worker limited to caching static assets (never streams nor the API).
- **Responsive**: mobile ≥ 360 px, tablet, desktop, adapted navigation (bottom bar on mobile).
- **Basic accessibility**: full keyboard navigation, visible focus, AA contrast, `aria-label` on the player controls, `prefers-reduced-motion` honoured.
- **States**: each screen defines its empty, loading (skeletons), error (message translated from the code) and offline (banner) states.

---

## 20. Security

- Passwords and PINs: argon2id (`Bun.password`), never logged.
- Sessions: httpOnly cookies, `SameSite=Lax`, `Secure` over HTTPS; check of the `Origin` header on every mutating request (`Origin: null` accepted only with `Sec-Fetch-Site: same-origin`, which the page cannot forge: WebKit's `sendBeacon`); bearer tokens shown only once, stored hashed.
- Rate limiting: 10 login attempts per 15 min per IP and per username (the slot is taken before the password check; a success resets the username counter, not the IP one), 5 PIN checks per minute per profile, 20 invitation acceptances per hour per IP.
- `TRUST_PROXY=false` by default: the client IP and scheme come from the direct connection. Behind a reverse proxy, the host sets it to `true` and the README explains why.
- Admin file browser: read-only, folders only, refuses paths outside `/`, does not follow symbolic links outside the browsed folder.
- Streams and images: every media URL is tied to a playback session or to an item visible to the account; no guessable URL without auth. A playback session (direct stream, HLS, heartbeats) can only be used by its account, from a resolved active profile that is its own or that sees its item (`<video>`/HLS streams and `sendBeacon` without `X-Profile-Id` take the auth session's last profile, updated by `X-Profile-Id` and `POST /profiles/:id/select`).
- Image uploads: type checked by magic signature, max size 10 MB, re-encoded by ffmpeg before storage.
- Subprocesses: arguments passed as an array, never through a shell; file paths never interpreted.
- Updates: SHA-256 check of the archive and of each file through the manifest, download only from `github.com/LeoMartinDev/projo/releases`.
- Headers: strict `Content-Security-Policy` (no inline, no external domain), `X-Content-Type-Options`, `Referrer-Policy: same-origin` (no referrer leaves the origin; with `no-referrer`, WebKit sends `Origin: null` on `sendBeacon`).
- Dependencies: `bun audit` in CI, pinned versions.

---

## 21. Non-functional

| Topic | Target |
|---|---|
| Library size | designed and tested for 20,000 items (generated fixtures) |
| Empty incremental scan | < 10 s on 5,000 files |
| First full scan | 5,000 files discovered, probed and classified in < 5 min excluding TMDB matching (parallel probing ×2) |
| Server startup | < 3 s before `/health` OK |
| Catalogue API | p95 < 100 ms for `/home`, each batch of `/home/categories`, `/movies`, `/search` on 20,000 items |
| Playback start | direct < 1 s; HLS remux < 3 s; HLS transcode < 5 s after the first segment |
| HLS seek | < 3 s |
| Server memory | < 300 MB excluding ffmpeg |
| Browsers | last two versions of Chrome, Edge, Firefox, Safari; iOS Safari; Android Chrome. No guarantee on TV browsers. |
| Server platforms | Linux x86_64 and arm64, Docker. |
| Observability | structured JSON logs on stdout with `code`, `jobId`, `sessionId`; `/health`; counters in the admin dashboard. No outgoing telemetry. |
| Backup | all of `/data`; "Export the database" runs a `VACUUM INTO` into `db/backups/`. |

---

## 22. Tests and CI

- **Unit (`bun test`)**: `core` and `application` without infrastructure, with in-memory adapters. Mandatory coverage: name parser (each row of §8 = at least one case), classifier, stability detection (simulated clock and FS), matching scoring, TMDB genre mapping (§9.1), track cascade, "watched" rule and Continue watching, selection and order of the home categories (§13.3), HLS playlist computation from a keyframe index, segment chain, `Result` and error mapping.
- **Integration**: SQLite repositories on a temporary database; scanner on real fixture trees (`test/fixtures/libraries/*`) including tiny video files generated by ffmpeg (`testsrc`), a simulated "being written" file, a `Subs/`, a multi-episode, a `cd1`/`cd2`; real ffprobe and ffmpeg; TMDB and segment providers replaced by test HTTP servers with recorded responses.
- **E2E (Playwright)**: the five journeys of §4 on Chromium, then a WebKit smoke test (playback and resume of a MKV on desktop Safari, the journeys tagged `@mobile` on the iPhone viewport), one at a time against a single server started with a fixture library. What a background job produces without a screen of its own (timeline thumbnails, fingerprints) is covered by the integration tests.
- **Lint and types**: `bun lint` (layers, classes, `null`), strict `tsc --noEmit`, `exactOptionalPropertyTypes`, `bun fmt`.
- **GitHub Actions CI**: on every push and PR: lint, types, unit, integration, e2e. On a `v*` tag: bundle build, generation of the manifest and `SHA256SUMS`, GitHub release with notes generated from the commits (Conventional Commits), build and push of the multi-arch runtime image if `runtime/` changed or if the tag is `runtime-*`.
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
| Hero video preview | 20 s from 25 %, 720p, muted by default, desktop only |
| Invitation | single use, 7 days |
| Session | 30 sliding days |
| TMDB image sizes | poster w500, backdrop w1280, logo w500, still w300, person w185 |
| HLS segments | 4 s in transcode, 3 to 8 s in remux |
| Qualities | Original, 1080p 8 Mb/s, 720p 4 Mb/s, 480p 1.5 Mb/s |
| Multichannel audio | stereo downmix |
| Trickplay | 1 image / 10 s, 320 px, 10×10 sprites |
| Fingerprinting | first 10 min, last 5 min, intro 15 to 150 s, 2 corroborating episodes |
| Segment providers | TheIntroDB, IntroDB, SkipDB, in this order, all enabled |
| Contribution | off |
| Metadata language | fr-FR, en-US fallback |
| Environment variables | `PORT`, `DATA_DIR`, `TRUST_PROXY`, `LOG_LEVEL` (fixed) |
| Data folder | `/data`, §5.4 layout (fixed) |
| Licence | MIT |
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
