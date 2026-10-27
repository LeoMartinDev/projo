# Code review: server and web client (2026-10-26)

Full review of `apps/server/src`, `apps/web/src` and `packages/` (about 70,000 lines without tests), on `main` at `f9f9d7b`. Line numbers refer to that commit. Nine reviewers each covered one area; every "must fix" finding was then checked again in the code, and the measured numbers come from scripts run against the real modules.

**What this code does:** projo is a media server for one household. The server (Bun, Hono, SQLite) scans folders, identifies titles through TMDB and streams them directly or as HLS (the video cut into small segments, remuxed or transcoded by ffmpeg). The web client is a React app served by the same server.

**Load assumed (PRODUCT.md §21):** one household, a few playbacks at once, up to 20,000 titles, server memory under 300 MB, catalogue API p95 under 100 ms.

**Baseline:** server and web typecheck pass, 2,128 tests pass. The mobile typecheck fails only because `expo-symbols` is not installed locally (`bun install`).

Each finding has four parts: what the code is, the problem with a concrete case, the smallest fix, and what happens if we skip it. Findings are numbered across groups.

## Must fix

### 1. An admin can lock themselves out of the administration for good

**Status:** done (`2396696`)

`apps/server/src/application/profile/profiles.ts:290-380`, `apps/server/src/application/profile/library-access.ts:76-115`, `apps/web/src/features/admin/accounts/ProfileCard.tsx:159-172`

- **What this is:** `/admin` needs an active profile without restrictions. Anyone may narrow a profile; only an admin on an unrestricted profile may widen one.
- **Problem:** nothing stops an admin from narrowing or deleting their last unrestricted profile. After that, no route can widen a profile or create one, and setup never reopens. Reproduced over HTTP: unticking your own profile in a library's "Profiles with access" is enough.
- **Fix:** one rule in `core/`, next to `removesLastAdmin`: an admin account keeps at least one unrestricted profile. The three writers (update, delete, library access) answer 409 otherwise. On the web, also call `profileUpdated` after a save.
- **If we skip it:** one misclick, and only a hand edit of the SQLite file brings the administration back.

### 2. Ticking every library turns a kids' profile into "All libraries"

**Status:** done (`db9173e`)

`apps/web/src/features/admin/accounts/ProfileCard.tsx:190-202`

- **What this is:** `toggleLibrary` saves `libraryAccess: 'all'` as soon as every current library is ticked.
- **Problem:** `all` also means every future library. With a single "Kids" library, ticking "Kids" already saves `all`.
- **Fix:** delete the promotion; only the "All libraries" checkbox sets `all`. Move `toggleLibrary` into a pure module with a test.
- **If we skip it:** the admin later creates "Horror" and the Kids profile sees it.

### 3. Leaving the player while it loads resets the resume point to 0

**Status:** done (`c73066c`)

`apps/web/src/features/player/PlayerPage.tsx:411-417`

- **What this is:** the heartbeat (the call every 10 s that keeps the session alive and saves the position) reads `video.currentTime`.
- **Problem:** before the video loads, `currentTime` is 0. The interval, the teardown and `pagehide` all send 0, and the server stores it as is.
- **Fix:** in `read`, return `session.startPositionMs` while `video.readyState === 0`, the same guard `beat` already has.
- **If we skip it:** "Resume at 1:12:03", the spinner turns, the user presses Back: the movie leaves Continue watching and starts over.

### 4. Migrations run with foreign keys on, so a table rebuild empties its child tables

**Status:** done (`c9f82a6`)

`apps/server/src/infrastructure/sqlite/database.ts:34`, `apps/server/src/infrastructure/sqlite/database.ts:117-127`

- **What this is:** `configure()` turns `foreign_keys = ON` before `migrate()`, and Drizzle runs all pending migrations in one transaction.
- **Problem:** SQLite ignores `PRAGMA foreign_keys=OFF` inside a transaction. When drizzle-kit rebuilds a table (`__new_x`, `DROP TABLE x`, as 0007 does), the `DROP` fires every `ON DELETE CASCADE`. 0007 rebuilt a table nothing points to, so nothing was lost so far.
- **Fix:** `PRAGMA foreign_keys = OFF` before `migrate`, then `PRAGMA foreign_key_check` (any row: `db/migration_failed`), then `ON` again.
- **If we skip it:** the first migration that rebuilds `profiles`, `items` or `sources` silently deletes progress, watchlists and segments on the real database. Reproduced on a test database.

### 5. An identification moves the locks of edited fields, not their values

**Status:** done (`b15f2ff`)

`apps/server/src/infrastructure/sqlite/metadata-item-repository.ts:235`, `apps/server/src/application/metadata/apply-match.ts:240-256`

- **What this is:** when a local item merges into a TMDB item, the fields the admin edited (`item_overrides`) move to the target.
- **Problem:** the target's columns keep the TMDB values. The field shows as locked, is never refreshed again, and the admin's value never shows.
- **Fix:** after `moveItemRows`, write the values again: `overrides.set({ itemId: into, overrides: overrides.get(into) })`.
- **If we skip it:** a corrected title turns back into "Inception". With an uploaded poster, the target ends with no poster at all (the lock makes `fetch_images` skip it).

### 6. The same merge drops the admin's manual marker

**Status:** done (`ee2185a`)

`apps/server/src/infrastructure/sqlite/metadata-item-repository.ts:217-222`

- **What this is:** a segment (intro, credits) of the old item moves only if the target has none of that type.
- **Problem:** a manual marker then loses to an IntroDB or fingerprint segment, against §12.1 (manual > chapters > databases > fingerprint).
- **Fix:** before the `UPDATE`, delete the target's non-manual segments of the types where the old item has a manual one. Adjust the existing test.
- **If we skip it:** admin corrections disappear without a message.

### 7. Queueing N jobs costs O(N²) and blocks the server

**Status:** done (`1d12c78`)

`apps/server/src/entrypoints/jobs/runner.ts:254`

- **What this is:** `enqueue` calls `wake`, which is `pump`: a synchronous claim query on every single enqueue.
- **Problem:** that query reads and sorts every queued row. A full scan enqueues one `probe_source` per file in one loop.
- **Fix:** `wake: schedulePump`. The coalescer already exists (line 215); a burst of enqueues then runs one pump.
- **If we skip it:** measured: 5,000 enqueues block 2.1 s, 20,000 block 28 s. The API, live events and video segments stop meanwhile.

### 8. Every login attempt runs a 64 MB hash, with no limit on how many run at once

**Status:** done (`5abf875`)

`apps/server/src/infrastructure/auth/bun-password-hasher.ts:10-27`, `apps/server/src/application/auth/login.ts:85-88`

- **What this is:** argon2id (the password hash) runs with Bun's default cost, including the decoy hash for unknown usernames.
- **Problem:** the §20 limit counts attempts per IP, not attempts running at the same time.
- **Fix:** a tiny queue with concurrency 1–2 around `hash` and `verify` in `createBunPasswordHasher`.
- **If we skip it:** measured: 10 parallel anonymous logins take memory from 69 to 678 MB. Anyone on the internet can push the server past 300 MB or get the container killed.

### 9. Remux holds a whole segment in memory

**Status:** done (`aaf74b3`)

`apps/server/src/infrastructure/playback/hls-segmenter.ts:218-236`, `apps/server/src/infrastructure/playback/hls-segmenter.ts:268-287`

- **What this is:** the boxes of a segment pile up in `parts`, then `new Blob(parts)` writes them in one go.
- **Problem:** memory follows bitrate × segment length, and remux sessions have no cap.
- **Fix:** open a `Bun.file(tmp).writer()` per segment and write each box as it arrives; `end()` then `rename` when complete.
- **If we skip it:** measured: a 70 Mb/s UHD remux peaks around 200 MB. Two people watching 4K go past the §21 budget.

### 10. An interrupted probe marks a good file as broken

**Status:** done (`ad445d1`)

`apps/server/src/application/scanner/probe-source.ts:137-158`

- **What this is:** any ffprobe or ffmpeg error other than "binary missing" moves the source to `pending` / `probe_failed`.
- **Problem:** a cancel, a clean stop (restart, update) or a timeout all arrive as `media/ffmpeg_failed`.
- **Fix:** if `signal.aborted`, return `err(job/cancelled)` without writing. Treat `media/timeout` like `binary_missing` (retry).
- **If we skip it:** restarting during a verify scan hides the titles being probed until the next scan. Reproduced.

### 11. Cancelling a running job frees its key before the job really stops

**Status:** done (`4a34d95`)

`apps/server/src/entrypoints/jobs/runner.ts:255-262`

- **What this is:** `cancel` writes `cancelled` at once, then asks the handler to stop.
- **Problem:** the dedupe only looks at `running` rows. A job with the same key starts while the old one still runs, and "Retry" runs the same job id twice.
- **Fix:** for a running job, `cancel` only aborts; `settle` writes `cancelled` when the handler returns.
- **If we skip it:** two scans of the same library run at once (reproduced), and `stop()` can close the database under a handler it no longer tracks.

### 12. Leaving while the session is being created leaves a ghost session

**Status:** done (`d4ed141`)

`apps/web/src/features/player/PlayerPage.tsx:285-293`

- **What this is:** the session is created in a `queryFn`; only the cleanup of the effect that attaches the video ends it.
- **Problem:** if the page unmounts before the response, the result is dropped and nobody calls `DELETE`.
- **Fix:** `queryFn: ({ signal }) => …`; if `signal.aborted` after the POST, end the session that was just created.
- **If we skip it:** with the default limit of 2 transcodes, someone who opens a movie and backs out quickly sees "Too many playbacks running on the server" for a minute.

### 13. The poster grid asks for the next page in a loop after an error

**Status:** done (`b2d0339`)

`apps/web/src/features/media/VirtualGrid.tsx:105-108`

- **What this is:** an effect calls `onMore()` near the end of the grid, and the pages pass a new function on every render.
- **Problem:** after a failure, `hasNextPage` stays true. The error causes a render, so a new function, so a new call.
- **Fix:** `hasMore={hasNextPage && !isFetchNextPageError}`, as `CategoryRows.tsx:40` already does, or the guard once in `VirtualGrid`.
- **If we skip it:** a lasting error on one page sends requests in a loop for as long as the tab stays open.

### 14. Markers of a multi-episode file are sent to the public databases

**Status:** done (`54cb5f0`)

`apps/server/src/application/segments/submit-segment.ts:53-63`

- **What this is:** a manual marker is submitted to TheIntroDB and SkipDB.
- **Problem:** for an `S01E01-E02` file, times are on the whole file's timeline. Reading already refuses this case (`fetch-segments.ts:118`); writing does not.
- **Fix:** `if (!target.ok || target.value.sharesFile) return ok('skipped')`.
- **If we skip it:** projo publishes an E02 intro at 44:10, wrong data for every other user of those databases.

### 15. Shows with numbers in their name get the wrong episode number

**Status:** done (`327a9e0`)

`apps/server/src/core/naming/analyze.ts:293-297`, `apps/server/src/core/naming/analyze.ts:349-357`

- **What this is:** in a show folder, a number that appears in the folder title is ignored.
- **Problem:** the check compares values, not positions, and the "leading number" rule skips it.
- **Fix:** ignore a number only when it sits inside the part of the name that matches the folder title; same rule for `findLeadingNumber`.
- **If we skip it:** `9-1-1 - 01.mkv` becomes S01E09 (a duplicate of E09, E01 missing). `Stargate SG-1 - 01`, `Babylon 5 - 05` and `Station 19 - 19` go to "To review".

## Should fix

### 16. A tab gets stuck when the server refuses its profile

**Status:** done (`cea327c`)

`apps/web/src/app/query-client.ts:10-23`

- **What this is:** the global error handler only handles "session lost".
- **Problem:** the PIN unlock is per browser session. Switching profile in a second tab makes every request of the first one answer 403 `profile/pin_required`.
- **Fix:** in `onError`, also handle `profile/pin_required`, `profile/forbidden` and `profile/required`: clear the active profile, invalidate `/auth/me`, go to `/profiles?redirect=…`.
- **If we skip it:** every page of that tab shows an error until a reload.

### 17. Live events never reconnect after a non-200 answer

**Status:** done (`7e4d425`)

`apps/web/src/shared/events/events.ts:32-67`

- **What this is:** one shared `EventSource` (the channel the server pushes live events on), with no `error` listener.
- **Problem:** after a 502 (a proxy during a restart), an `EventSource` goes to CLOSED for good, and the dead object keeps being reused.
- **Fix:** on `error` with `readyState === 2`: close, reopen after a delay, re-wire the listened types, invalidate `['catalog']`.
- **If we skip it:** after an update behind a proxy, no more scan progress, badges or session ends until a reload.

### 18. A pause on a locked iPad ends on an error screen

**Status:** done (`20c11db`)

`apps/web/src/features/player/PlayerPage.tsx:419-427`, `apps/web/src/features/player/PlayerPage.tsx:481-489`

- **What this is:** the heartbeat relies on `setInterval`; the server ends a session after 60 s without one.
- **Problem:** iOS suspends JavaScript when the screen locks, and Chrome spaces timers out in hidden tabs. `session_expired` is then treated as fatal.
- **Fix:** handle `session_expired`, `session_not_found` and a timeout termination like a network loss: reopen at the last position when the page is visible again.
- **If we skip it:** every pause longer than a minute on mobile ends on "Playback failed".

### 19. The next episode closes fullscreen and Picture-in-Picture

**Status:** to do

`apps/web/src/app/router.tsx:358`

- **What this is:** the route renders `<PlayerPage key={itemId}>`, and fullscreen is requested on the player's container.
- **Problem:** a new episode replaces the container and the `<video>`, so the browser leaves fullscreen and closes PiP.
- **Fix:** request fullscreen on `document.documentElement`. To keep PiP, keep the same `<video>` (no `key`).
- **If we skip it:** binge-watching needs a click on fullscreen at every episode.

### 20. "Retry" on the root error screen does nothing

**Status:** done (`de2f499`)

`apps/web/src/app/router.tsx:151`

- **What this is:** `onRetry={reset}`.
- **Problem:** `reset` only clears the error boundary; the failed route throws the same error again.
- **Fix:** `onRetry={() => void router.invalidate()}`.
- **If we skip it:** opening the app during a server restart leaves a dead button; only a reload helps.

### 21. Escape in a nested dialog also closes the parent dialog

**Status:** done (`11756bb`)

`apps/web/src/shared/ui/Dialog.tsx:41-45`

- **What this is:** each `Dialog` calls `onClose` on `cancel` and `close`.
- **Problem:** React 19 propagates `cancel` and `close` up the component tree (checked in react-dom 19.3.1).
- **Fix:** ignore the event when `event.target !== event.currentTarget`.
- **If we skip it:** Escape on "Delete the profile" also closes the account dialog and loses unsaved edits.

### 22. Deleting one of your own PIN-protected profiles is a dead end

**Status:** done (`b474f53`)

`apps/web/src/features/admin/accounts/ProfileCard.tsx:84-107`

- **What this is:** the delete dialog sends the PIN typed in the profile card.
- **Problem:** the PIN field only shows after a failed save of the card, never after the 403 of the delete.
- **Fix:** show the PIN field in `DeleteProfileDialog` when `profile.hasPin`.
- **If we skip it:** the admin cannot delete the PIN-protected Kids profile of their own account.

### 23. Removing a root folder and saving deletes its sources without confirmation

**Status:** done (`9402964`)

`apps/web/src/features/admin/LibraryForm.tsx:218-225`

- **What this is:** the cross removes the root from the list; Save sends the new list.
- **Problem:** the server deletes the root's sources and the progress of its local items, and stops playbacks on them. Deleting a library asks for confirmation (§15); removing a root does not.
- **Fix:** on save, confirm by naming each removed root with its file count.
- **If we skip it:** one stray click wipes the analysis of thousands of files.

### 24. Every image refresh wipes the intro databases' cache

**Status:** done (`644b28c`)

`apps/server/src/application/segments/request-segments.ts:26-38`

- **What this is:** after each `fetch_images`, the providers' `none` and `error` answers are deleted and the chain runs again.
- **Problem:** the weekly refresh and "Refresh all" run `fetch_images` again. This breaks the §12.2 rule "`none` retried after 30 days".
- **Fix:** delete the removal loop. `isLookupFresh` already skips fresh answers.
- **If we skip it:** the TheIntroDB quota (500 requests a day without a key) runs out, and new episodes wait days for their markers.

### 25. Matching subtitles to videos is quadratic per folder

**Status:** to do

`apps/server/src/core/naming/subtitles.ts:79-108`

- **What this is:** on every scan, each subtitle is compared with each video of its folder.
- **Problem:** §8.1 accepts a single flat movies folder, and this work blocks the server while it runs.
- **Fix:** one `Map` of video names per folder, then look up the subtitle's name and its prefixes cut at `.` or `-`; `push` instead of the spread in `groupByDirectory`.
- **If we skip it:** measured: 2.9 s blocked for 5,000 movies with subtitles in one folder, on every scan.

### 26. "Up next" forgets a show once its watched seasons are deleted

**Status:** to do

`apps/server/src/infrastructure/sqlite/progress-repository.ts:98-117`

- **What this is:** `listPlayed` keeps only the progress of episodes whose file still exists.
- **Problem:** once season 1 is deleted, the show counts as "not started". §13.1 plans the "New episode" badge for exactly this case.
- **Fix:** for episodes, require the series to be visible rather than the episode, and find the next episode by season and episode numbers. Medium confidence: §6.3 can be read the other way.
- **If we skip it:** households that free disk space never see season 2 in Up next.

### 27. Editing a library accepts a root that overlaps a kept symlinked root

**Status:** to do

`apps/server/src/application/library/validate-roots.ts:56-60`

- **What this is:** roots already saved skip `realPath`.
- **Problem:** the overlap check then compares the link's unresolved path with the new root's real path.
- **Fix:** always resolve with `realPath`; keep the shortcut for the disk checks only.
- **If we skip it:** with `/alias → /mnt/media` and `/mnt/media/movies`, every file counts twice.

### 28. The update download URL check is only a string prefix

**Status:** done (`b03264c`)

`apps/server/src/infrastructure/updates/github-release-source.ts:134-136`, `apps/server/src/infrastructure/updates/release-installer.ts:222-228`

- **What this is:** a URL that does not start with `https://github.com/LeoMartinDev/projo/releases/download/` is refused.
- **Problem:** `…/download/../../../../attacker/…` passes the check, and `fetch` goes to `github.com/attacker/…` (checked with `new URL`). SHA256SUMS comes from the same answer, so it does not help.
- **Fix:** compare `origin` and `pathname` of `new URL(url)`. Add a test with a foreign host and one with `..`.
- **If we skip it:** the §20 rule holds by luck. Exploiting it still needs a tampered API answer.

### 29. The Updates page answers 500 after going back to an older version

**Status:** done (`83915a5`)

`apps/server/src/infrastructure/sqlite/update-repository.ts:12`

- **What this is:** the run errors are read with `z.enum(errorCodes)`.
- **Problem:** an error code written by a newer version makes the read throw.
- **Fix:** `code: z.string()`, like `jobErrorSchema`.
- **If we skip it:** the page that holds "Update" and "Go back" no longer opens.

### 30. Six stores only grow

**Status:** to do

- **What this is:** nothing deletes:
  - images of purged titles (files and rows);
  - `tmdb_responses`, which keeps the full raw JSON;
  - notifications, read with a full table scan and no index;
  - database backups (two full copies per update with migrations);
  - `cache/keyframes`;
  - `scan_runs`.
- **Problem:** the dev `.data/db/backups` already holds 9 copies after 2 days.
- **Fix:** extend the hourly `purge-jobs` task to delete unreferenced images, `tmdb_responses` older than 30 days (and store `parsed.data` only), resolved notifications older than 30 days (with an index on `(kind, resolved_at)`), old `scan_runs`, and backups beyond the last N. Keyframes of gone sources belong in `media-assets-cleanup`.
- **If we skip it:** `/data` slowly fills until the `disk_low` alert fires.

### 31. The 10 MB image limit can be bypassed with a chunked body

**Status:** done (`712fdec`)

`apps/server/src/entrypoints/http/routes/admin-items.ts:89-121`

- **What this is:** a declared `Content-Length` that is too large is refused, then `formData()` reads the whole body into memory.
- **Problem:** without `Content-Length`, only Bun's default limit applies: 128 MB.
- **Fix:** set `maxRequestBodySize` to about 11 MB in `Bun.serve`.
- **If we skip it:** 120 MB are held in memory before the 413. The route is admin-only.

### 32. Whoever reaches a fresh install first becomes its admin

**Status:** to do

`apps/server/src/application/setup/complete-setup.ts:40-54`

- **What this is:** `POST /setup` is public while no account exists; §15 states this.
- **Problem:** nothing ties the setup to the owner of the machine.
- **Fix:** print a one-time code in the startup logs and require it for setup (a spec proposal).
- **If we skip it:** on an exposed VPS, a scanner can finish the setup before the owner.

### 33. Accepting an invitation while signed in keeps the other account's cache

**Status:** done (`a7b2eba`)

`apps/web/src/features/invite/InvitePage.tsx:87-90`

- **What this is:** after accepting, only `['catalog']` is cleared.
- **Problem:** this is an account switch: the previous account's profiles and devices stay cached.
- **Fix:** `signedOut(queryClient); signedIn(queryClient, me)`.
- **If we skip it:** the new user sees the admin's profiles, and picking one fails with 403.

### 34. A library can stay "Scanning…" forever

**Status:** to do

`apps/web/src/features/admin/live-scans.ts:146-172`

- **What this is:** only `scan.finished` removes the live "running" state.
- **Problem:** a cancelled scan publishes no `scan.finished`, and an event lost during a disconnection is never replayed.
- **Fix:** keep `scanRunId` in the live state and treat it as stale once `lastScan` of that run has a `finishedAt`.
- **If we skip it:** a frozen bar and a disabled Sync button.

### 35. The Updates page shows an error during the restart

**Status:** done (`e083d36`)

`apps/web/src/features/admin/updates/UpdatesPage.tsx:311-316`

- **What this is:** when the status fails to load, the whole page is replaced by the error state.
- **Problem:** one failed background refetch while the server restarts is enough.
- **Fix:** show the error only when `status.data === undefined`, as `DashboardPage` does.
- **If we skip it:** the admin thinks the update failed while it is in progress.

### 36. "Copy" for the docker command fails on plain HTTP

**Status:** done (`6a16279`)

`apps/web/src/features/admin/updates/UpdatesPage.tsx:83-85`

- **What this is:** the button calls `navigator.clipboard` directly.
- **Problem:** without HTTPS, `navigator.clipboard` does not exist.
- **Fix:** move `copyText` from `Invitations.tsx:19-32` to `shared/ui` and use it here too.
- **If we skip it:** on a LAN install over HTTP, the click copies nothing and shows nothing.

### 37. The image upload does not send `X-Profile-Id`

**Status:** done (`e50a544`)

`apps/web/src/features/admin/metadata/queries.ts:79-91`

- **What this is:** the only hand-written `fetch` in the admin.
- **Problem:** without the header, the server takes the session's last profile, which can be a child's in another tab.
- **Fix:** add the active profile header, as the `hc` client does.
- **If we skip it:** random 403s when choosing a poster.

### 38. A library is created even when saving its access fails

**Status:** done (`7c35eca`)

`apps/web/src/features/admin/LibraryForm.tsx:110-128`

- **What this is:** the form POSTs the library, then PUTs the profiles.
- **Problem:** if the PUT fails, the form stays in create mode and a retry POSTs again.
- **Fix:** after a successful POST, switch the form to edit mode.
- **If we skip it:** the chosen access is lost, and the retry fails with `library/name_taken`.

### 39. "Check again" stays disabled after one click

**Status:** done (`8dfaa01`)

`apps/web/src/features/admin/operations/SourceStatePages.tsx:103-113`

- **What this is:** the button adds the source id to a `requested` set that disables it.
- **Problem:** the set is never cleared.
- **Fix:** rely on `recheck.isPending` instead.
- **If we skip it:** checking the same file again needs a page change.

### 40. Safari does not retry while the keyframe index is not ready

**Status:** to do

`apps/web/src/features/player/playback.ts:174-183`

- **What this is:** with hls.js, a 503 `keyframes_unavailable` is retried for about 5 minutes. Safari uses its native HLS player.
- **Problem:** the native path reports the error at once. Medium confidence: not run in Safari.
- **Fix:** on the native path, `fetch` the playlist until it is not 503 (same budget) before setting `video.src`.
- **If we skip it:** the first play of a big file on a network share fails on Safari and works on Chrome.

### 41. Resuming starts a wasted ffmpeg run at segment 0

**Status:** to do

`apps/server/src/infrastructure/playback/hls-segmenter.ts:522`

- **What this is:** an `init.mp4` request that comes before any segment request starts ffmpeg at segment 0.
- **Problem:** hls.js always asks for `init` first, then the resume segment kills that run and starts another one.
- **Fix:** start at the segment that holds `session.startPositionMs`.
- **If we skip it:** every resume and every track or quality change encodes one segment for nothing; a 4K transcode takes nearly twice as long to start.

### 42. Live refreshes refetch every loaded page

**Status:** to do

`apps/web/src/app/AuthedLayout.tsx:20-32`, `apps/web/src/features/admin/operations/queries.ts:86-114`

- **What this is:** a live event calls `invalidateQueries`, at most every 1.5 to 2 s.
- **Problem:** TanStack refetches every loaded page one after another, and each new event restarts the whole sequence.
- **Fix:** `{ cancelRefetch: false }`, and skip the live refresh when more than one page is loaded.
- **If we skip it:** during a long identification, a tab scrolled far down sends 10 to 20 requests a second.

### 43. /home computes Up next in quadratic time, twice

**Status:** to do

`apps/server/src/application/home/get-home.ts:61-80`

- **What this is:** for each watched show, the code scans the whole history twice.
- **Problem:** the same rule also lives in `core/progress/rows.ts:120-123`.
- **Fix:** one `upNextCandidates` function used in both places.
- **If we skip it:** measured: 110 ms for /home with 500 watched shows, already above the §21 target of 100 ms.

### 44. Excluded folders are read on every scan

**Status:** to do

`apps/server/src/application/scanner/walk-root.ts:91-118`

- **What this is:** each subfolder gets a `stat` and a `readdir` before the code decides to skip it.
- **Problem:** `@eaDir`, `.trickplay` and `Extras` can be skipped on their name alone.
- **Fix:** drop those names before pushing them on the walk stack.
- **If we skip it:** on a Synology NAS, 3,000 `@eaDir` folders add an estimated 6 to 12 s to every incremental scan.

### 45. The image visibility check is optional

**Status:** to do

`apps/server/src/entrypoints/http/routes/images.ts:25-41`

- **What this is:** `canView` is called only if the module was given one.
- **Problem:** forgetting it in the wiring opens every image to every profile, and typecheck does not notice.
- **Fix:** make `canView` required; pass `() => true` in `metadata-world`.
- **If we skip it:** a future refactor can break §14 silently.

### 46. No test covers `X-Forwarded-For`

**Status:** to do

`apps/server/src/entrypoints/http/client-info.ts:20-41`

- **What this is:** the client IP behind every per-IP rate limit.
- **Problem:** no test fails if the header is read while `TRUST_PROXY` is off.
- **Fix:** two tests: 11 logins with a changing header get 429; `spoofed, 1.2.3.4` counts against `1.2.3.4`.
- **If we skip it:** a one-character regression removes the brute-force protection.

### 47. The player's session lifecycle has no test

**Status:** to do

`apps/web/src/features/player/PlayerPage.tsx:229-545`

- **What this is:** creation, heartbeat, switching, reconnection and UI all live in one 1,477-line component.
- **Problem:** findings 3, 12 and 18 are in this block, and no test would have caught them.
- **Fix:** extract `usePlaybackSession` with the transport and timers injected (as `heartbeat.ts` already does) and test it with fakes.
- **If we skip it:** player regressions only show up in e2e or in use.

### 48. The §21 performance test skips categories and restricted profiles

**Status:** to do

`apps/server/test/integration/catalog-perf.test.ts:159-168`

- **What this is:** it measures /home, /movies, /series and /search without restrictions.
- **Problem:** §21 also names /home/categories, and the kids' profile path is slower (measured 55 ms against 33 ms).
- **Fix:** add those URLs and run the list again for a kids' profile.
- **If we skip it:** the costliest endpoints can slow down unnoticed.

### 49. No PWA at all

**Status:** to do

`apps/web/index.html`

- **What this is:** no manifest, no icons, no service worker; `public/` is empty.
- **Problem:** §2.1 and §19 put the PWA in v1.
- **Fix:** add `manifest.webmanifest` and icons. A service worker, if added, caches `/assets/*` only.
- **If we skip it:** "Add to Home Screen" only creates a bookmark.

### 50. Near-copies that must change together

**Status:** to do

- **What this is:**
  - two ffprobe adapters and two parsers, with copy-pasted HDR detection (`infrastructure/playback/ffprobe.ts`, `infrastructure/media/ffprobe.ts`); the playback one has no timeout;
  - Range serving copied in `routes/stream.ts` and `routes/previews.ts`;
  - the TMDB en-US fallback copied in `resolve-match.ts` and `tmdb-details.ts`;
  - the password form written three times, `safeRedirect` twice;
  - `useStoredError` copied in `UpdatesPage.tsx`;
  - `regularEpisodes` twice, `chunks` three times;
  - card actions copied between `MediaCard` and `CardSheet`: the desktop preview swallows errors.
- **Problem:** fixing one copy leaves the other wrong.
- **Fix:** keep one version of each and import it everywhere.
- **If we skip it:** the copies drift; they already have for ffprobe (timeout) and card actions (errors).

### 51. Dead code

**Status:** to do

- **What this is:**
  - 14 error codes the server never sends (`auth/password_too_weak`, `source/too_small`, …), each present in 4 places;
  - `accounts/summary.ts`, the profile summary §15 asks for but nothing renders;
  - `AccountRepository.count`, `isActive`, the `subtitleStream` branch, `mediaAssets.trickplayUrl`;
  - about 16 re-exports of the `naming` barrel;
  - `fromNullable`, `DirectoryCache.forget`, the catalogue `order` option, `canEditPin`.
- **Problem:** nothing calls them (checked by grep, mobile included).
- **Fix:** delete them, except the profile summary, which is better shown in the accounts list.
- **If we skip it:** code to maintain and translate for nothing.

## Nice to have

### 52. Grouping sources by root is quadratic

**Status:** to do

`apps/server/src/core/scanner/sync.ts:15-18`

- **What this is:** each source copies its root's whole array.
- **Problem:** measured 505 ms for 20,000 sources in one root, on every scan.
- **Fix:** `push` into the existing array.
- **If we skip it:** a fixed cost on every scan that grows fast with the library.

### 53. Invitation tokens appear in debug logs

**Status:** to do

`apps/server/src/entrypoints/http/app.ts:34-41`

- **What this is:** at debug level, every request is logged with its full path.
- **Problem:** `/invitations/<token>` carries the invitation secret.
- **Fix:** log `c.req.routePath` instead of the path.
- **If we skip it:** anyone who reads the logs can create an account.

### 54. Search does not fold ligatures

**Status:** to do

`apps/server/src/core/catalog/search.ts:12-19`, `apps/server/drizzle/0002_search.sql:11`

- **What this is:** the FTS5 index removes accents but does not split œ, æ, ß.
- **Problem:** "coeur" does not find "Cœur".
- **Fix:** map œ→oe, æ→ae, ß→ss in the query and in the triggers (a custom migration).
- **If we skip it:** some French titles cannot be found the way people type them.

### 55. Trickplay sheets stay cached a day after regeneration

**Status:** to do

`apps/server/src/entrypoints/http/routes/trickplay.ts:64`

- **What this is:** sheets are served with `max-age=86400` on a URL that never changes.
- **Problem:** when the video file is replaced, browsers keep the old sheets.
- **Fix:** add `?v=<mtime>` to the URL.
- **If we skip it:** thumbnails of the old file for up to 24 h.

### 56. Two database exports in the same second

**Status:** to do

`apps/server/src/core/stats/stats.ts:58-62`

- **What this is:** the export file name has second precision.
- **Problem:** `VACUUM INTO` refuses an existing file.
- **Fix:** add milliseconds to the name.
- **If we skip it:** a double click answers 500 although the first export worked.

### 57. An admin on the Kids profile sees the admin's empty state

**Status:** done (`c24b485`)

`apps/web/src/features/home/HomePage.tsx:54`, `apps/web/src/features/catalog/CatalogPage.tsx:179`

- **What this is:** the page tests `role === 'admin'`.
- **Problem:** the test ignores the active profile.
- **Fix:** `canAdminister(me)`.
- **If we skip it:** a child sees a "Manage libraries" button that leads nowhere.

### 58. English shows "Cancel" where the spec says "Undo"

**Status:** to do

`apps/web/src/features/player/SkipSegment.tsx:73`, `apps/web/src/features/player/TrackToast.tsx:54`

- **What this is:** both toasts use `common.cancel`.
- **Problem:** §10.7 and §11.3 say "Undo".
- **Fix:** add a `common.undo` key.
- **If we skip it:** the English copy does not follow the spec.

### 59. Every card downloads a hidden 1280 px backdrop

**Status:** to do

`apps/web/src/features/media/MediaCard.tsx:248-250`

- **What this is:** the hover preview is rendered hidden, with its image.
- **Problem:** lazy loading ignores `visibility: hidden`, so the image still downloads.
- **Fix:** pass `src` only on hover or focus.
- **If we skip it:** about 35 extra images on every home visit.

### 60. The weekly refresh includes shows without any file

**Status:** to do

`apps/server/src/infrastructure/sqlite/metadata-editing-repository.ts:213-228`

- **What this is:** the query takes every show in production.
- **Problem:** it also takes shows that have no file left.
- **Fix:** add the `EXISTS` condition already used by `topLevelWithFiles`.
- **If we skip it:** TMDB quota spent every week for nothing.

### 61. §9.1 says the TMDB key is embedded; it is not

**Status:** to do

- **What this is:** the README says a key is required.
- **Problem:** the spec is wrong on this point.
- **Fix:** update §9.1.
- **If we skip it:** the spec contradicts the code.

## Summary

- **Verdict:** fix 1 to 15 first; 1 to 9 are the most urgent.
- **Done:** 1 to 18, 20 to 24, 28, 29, 31, 33, 35 to 39, 57 (2026-10-27, commit hash on each heading).
- **Lean:** about −500 lines possible.
- **Not checked:** nothing was run in a real browser (Safari, iOS, PiP) or in the Linux Docker image; argon2 and remux memory were measured on macOS. The §20 capability URLs are not built yet (M6 slice 5). The VAAPI/HDR commit `f9f9d7b` landed during the review and is only partly covered.
