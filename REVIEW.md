# Code review: whole repository (2026-10-30)

Audit of the whole repository (`apps/server`, `apps/web`, `apps/mobile`, `packages/`, `runtime/`), on `main` at `d968881`. Line numbers refer to that commit. The login, session and profile code was read by hand and showed nothing wrong; five reviewers read the rest. The top findings were checked again in the code, and the measurement of 1 was run again.

**What this code does:** projo is a self-hosted media server for one household. The server (Bun, Hono, SQLite) scans video folders, identifies the files through TMDB and streams them to a web app and an iOS app, with profiles, kids' limits, progress and self-updates.

**Load assumed (PRODUCT.md §21):** one server process, a handful of people and devices, a few playbacks at once, up to 20,000 titles.

**Baseline:** the audit ran no tests. After the fixes (`21999f6`): lint, typecheck and format pass, 2,220 tests pass (8 skipped).

Each finding has four parts: what the code is, the problem with a concrete case, the smallest fix, and what happens if we skip it. Findings are numbered across groups. The previous review (2026-10-26) is in git (`git show 7ec1736:REVIEW.md`); its open findings are listed at the end.

## Must fix

### 1. Kids' profiles make the catalogue take seconds

**Status:** done (`21999f6`)

`apps/server/src/infrastructure/sqlite/catalog-sql.ts:23-27`

- **What this is:** for a profile limited to some libraries, the catalogue queries add a filter on the source's library.
- **Problem:** SQLite then drives the query from the library index and reads every file of the library instead of the few items it needs. With 20,000 items, `/home` takes 1.9 s for a kids' profile (33 ms for an adult) and `/series` 3.2 s. Measured again: 1,415 ms as written, 0.3 ms with the fix, same rows.
- **Fix:** write `+library_id IN (…)`: the `+` keeps SQLite off that index, the trick already used for `state` two lines below. Add a restricted profile to `catalog-perf.test.ts`, which tests only an unrestricted one.
- **If we skip it:** the kids' profile, a v1 feature, is the slowest profile in the house.

### 2. Renaming an unidentified file deletes its watch history

**Status:** done (`21999f6`)

`apps/server/src/application/scanner/link-source-items.ts:107-119`, `apps/server/src/application/metadata/review.ts:349`

- **What this is:** a file TMDB has not identified gets a local item built from its file name. When the name changes, the file moves to a new local item and the old one is deleted.
- **Problem:** deleting an item cascades to its progress, My list and track choices; nothing copies them first. Renaming `Home Video.mkv` to `Family Trip (2019).mkv` loses the progress, and so does every full scan after a naming-rules update. Hiding a file in "To review" deletes them too, while §7.8 says the item only becomes invisible.
- **Fix:** before deleting, move the rows with `moveItemRows`, as `apply-match.ts` already does from local to TMDB. When hiding, don't delete.
- **If we skip it:** family members lose their place without any error.

### 3. A symlinked folder whose target is down counts as deleted

**Status:** done (`21999f6`)

`apps/server/src/application/scanner/walk-root.ts:140-156`

- **What this is:** the scan follows symbolic links to folders inside a library.
- **Problem:** when the target cannot be reached, the link is skipped as "other", with no error. With a root `/media` holding `nas -> /mnt/nas`, every NAS file is marked missing while the NAS is down, and after 30 days `purge_missing` deletes them with their history. Reproduced on a real temporary folder.
- **Fix:** when a link's target cannot be read, add it to `failedDirectories`; the scan already protects what is under those.
- **If we skip it:** a NAS down for a month erases its part of the library.

### 4. The mobile app sends the old server's token to a new address

**Status:** done (`21999f6`); no automated test (the mobile app has no component tests)

`apps/mobile/src/features/server-connection/ServerConnection.tsx:82-94`, `apps/mobile/src/features/session/Session.tsx`

- **What this is:** the app keeps its bearer token (its sign-in key) in the Keychain, and the server address separately.
- **Problem:** `connect` saves a new address but never clears the token; only "Forget" does. If the home server is unreachable and the user types another address, the old token goes to that host in `Authorization`. Pairing (`adopt`) does the same.
- **Fix:** in `connect` and in the pairing flow, call `sessionStore.clear()` when the new address differs from the stored one.
- **If we skip it:** a typo in the address can hand a working token to someone else's server.

### 5. A short TMDB outage floods admins with notifications

**Status:** done (`21999f6`)

`apps/server/src/application/jobs/notify-job-failure.ts:16`

- **What this is:** a job that fails its last attempt creates an admin notification.
- **Problem:** the notification is keyed by the job's id, so each failed job opens its own. Retries wait only 30 s then 60 s, so a few minutes of TMDB downtime during a big scan fail thousands of matching jobs: measured 20,000 notifications, about 70 s of blocked server and 20,000 live events. Nothing ever closes them.
- **Fix:** key it by `${job.type}:${job.error?.code}`, so the same failure stays one open notification.
- **If we skip it:** the first scan on a day TMDB has trouble freezes the server and buries the notifications page.

### 6. Stopping the container during an update skips the safety net

**Status:** done (`21999f6`)

`runtime/supervisor/supervisor.ts:162-199`

- **What this is:** the supervisor (the small process that switches app versions) points `current` at the new version, then gives it 60 s to pass a health check, or rolls back.
- **Problem:** a stop during the database copy exits the loop with `current` already moved, and no health check or rollback. `pending` is already deleted, so the next boot runs the new version as if confirmed; if it is broken, it restarts in a loop forever.
- **Fix:** when the loop ends with a switch in progress, call `switchHandler.rollback(switching, 'stopped')`.
- **If we skip it:** one badly timed restart can strand the install on a broken version.

### 7. "Apply to the whole season" puts the credits 20 minutes too early

**Status:** done (`21999f6`)

`apps/server/src/application/segments/markers.ts:205-220`

- **What this is:** the admin sets the intro and credits on one episode and copies them to the others.
- **Problem:** the credits are copied at the same clock time. Credits at 41:30 on a 43-minute episode land at 41:30 on a 65-minute finale: the player marks the finale watched and, with auto-skip credits, jumps to the next episode 23 minutes early.
- **Fix:** for credits and previews, count back from the end: `start = episodeLength - (sourceLength - start)`, with a test on two episode lengths. §12.5 only said "copied"; it now says so.
- **If we skip it:** people miss the end of season finales.

### 8. Intro and credits timed on one version are used for another

**Status:** done (`21999f6`)

`apps/server/src/application/playback/session-lifecycle.ts:244-266`, `apps/server/src/application/playback/create-session.ts`

- **What this is:** segments (intro, credits) are stored once per title, timed on the best-ranked file.
- **Problem:** with a 2h00 theatrical cut and a 2h30 extended cut, Chrome plays the extended one: at 1h52 it is marked watched, 38 minutes before the end, and leaves Continue watching.
- **Fix:** in the heartbeat and in `create-session.ts`, ignore segments when the played file's length differs from the reference length by more than a few seconds (5 s).
- **If we skip it:** titles with two cuts lose their resume point.

## Should fix

### 9. A failed probe overwrites what happened in the meantime

**Status:** to do

`apps/server/src/application/scanner/probe-source.ts:80-94`

- **What this is:** after ffprobe (the tool that reads a video's tracks) runs, the failure paths set the file back to `pending`.
- **Problem:** they do not re-read the row first, while the success path does. A file the admin hid during the probe comes back from "Hidden"; a file deleted meanwhile goes from `missing` to `pending`, which restarts its 30-day purge clock.
- **Fix:** re-read the row before each failure write, and skip it if the state or path changed.
- **If we skip it:** hiding a file sometimes does not stick.

### 10. Automatic matching can undo a manual correction

**Status:** to do

`apps/server/src/application/metadata/match-source.ts:164-165`

- **What this is:** after TMDB answers, the job checks only that the file is still `ready`.
- **Problem:** if the admin fixes the match in "To review" while the job waits on TMDB, the job writes over it or sends the file back to review. The correction is never applied again, because matched files are skipped.
- **Fix:** also skip when the fresh row's `matchState` is `matched` or `manual`.
- **If we skip it:** admin fixes vanish at random during big scans.

### 11. "Recheck" silently does nothing during a full scan

**Status:** to do

`apps/server/src/infrastructure/sqlite/job-repository.ts:61-79`

- **What this is:** a new job with the dedupe key of a queued one is merged into it.
- **Problem:** the merge keeps the old payload. A full scan queues a `verify` probe for every file; an admin "Recheck" merges into it and runs as `verify`, which returns `unchanged` without decoding.
- **Fix:** add `payload: job.payload` to the merge, so the latest request wins.
- **If we skip it:** the admin thinks a file was rechecked when it was not.

### 12. Retrying an old update job reinstalls the running version

**Status:** to do

`apps/server/src/application/updates/apply-update.ts:115-179`

- **What this is:** the `apply_update` job installs a release and asks for a switch.
- **Problem:** it never checks that the version is newer. "Retry" on an old failed job for the version already running deletes and rewrites the running version's folder, then restarts for nothing. A cancel that arrives after the download is ignored and the switch still happens.
- **Fix:** return an error when `!isNewerVersion(version, appVersion)`, and check `signal.aborted` right after `install`.
- **If we skip it:** one click on the Jobs page restarts the server and rewrites live files.

### 13. Database backups are never deleted

**Status:** to do

`runtime/supervisor/switch.ts:103-115`, `apps/server/src/infrastructure/sqlite/database.ts:101-105`

- **What this is:** each version switch copies the database, and so does each start with pending migrations.
- **Problem:** nothing removes old copies. Git shows 14 releases in 5 days, so `/data` grows by one full database per release.
- **Fix:** in `confirm`, keep only `projo-<from>.db`; in `openDatabase`, keep the last two pre-migration copies.
- **If we skip it:** the disk-low warning eventually fires for no good reason.

### 14. The rollback copies over the live database in an unsafe order

**Status:** to do

`runtime/supervisor/switch.ts:117-124`

- **What this is:** a rollback copies the backup onto `projo.db`, then deletes the WAL files (SQLite's journal of pending writes).
- **Problem:** a kill in between can leave a half-copied file, or the new version's journal replayed onto the old database; either way the next boot fails on a malformed database. Plausible, not reproduced: it needs a kill at that exact moment.
- **Fix:** delete `-wal` and `-shm` first, copy to `projo.db.restore`, then `rename` it over `projo.db`.
- **If we skip it:** a rare rollback can corrupt the only database.

### 15. Cancelling a scan at the wrong moment turns moved files into new ones

**Status:** to do

`apps/server/src/application/scanner/scan-library.ts:286-308`

- **What this is:** moved files are paired with their old record by probing them.
- **Problem:** a restart during that step aborts ffprobe, and the plan is applied anyway without the pairings. Each moved file becomes a new file plus a missing one, and the next scan cannot repair it.
- **Fix:** after `signaturesFor`, if `signal?.aborted`, end the run as `job/cancelled`, as the walk step already does (lines 246-254).
- **If we skip it:** an update during a reorganisation leaves a pile of "Missing" entries and matching work.

### 16. Kids' limits are opt-in per module, with no test on the real wiring

**Status:** to do

`apps/server/src/entrypoints/modules/catalog.ts:25-27`

- **What this is:** each module takes a `visibilityScope` that defaults to "show everything" (`allVisible`); `canView` on images is optional too (finding 45 of the previous review).
- **Problem:** today's wiring is correct, but dropping `{ visibilityScope }` from one module in `main.ts` still typechecks, and no test starts the real server with a restricted profile. A kids' profile would then get 200 on a hidden title's segments or poster.
- **Fix:** make both arguments required and pass `allVisible` explicitly in tests. Add one `startProjo` test: a capped profile gets 404 on a hidden item and on its image.
- **If we skip it:** one refactor can silently break the kids' profile.

### 17. Every image request checks visibility twice, slowly

**Status:** to do

`apps/server/src/infrastructure/sqlite/image-repository.ts:29-37`

- **What this is:** `canView` already checks the profile's limits; `findServable` then runs its own copy of the same check.
- **Problem:** the second check scans `items` and every ready file: 4 to 16 ms per image, against 0.23 ms for `canView`. A page with 20 cast photos adds about 120 ms of blocked server.
- **Fix:** make `canView` required, have `getImage` use `images.findById`, and delete `visibleItem`.
- **If we skip it:** title pages stay slow, and two copies of one rule can drift apart.

### 18. Restarting playback in the credits brings an episode back to "in progress"

**Status:** to do

`apps/server/src/application/playback/create-session.ts:472-486`

- **What this is:** starting a session saves the start position.
- **Problem:** unlike the heartbeat, it skips the "credits count as watched" rule. Changing the audio track in the credits stores 86 % as in progress, which blocks the show's Up next.
- **Fix:** apply `creditsStartOf` there too, on the segments `segmentsForVersion` keeps (since 8).
- **If we skip it:** finished episodes come back in Continue watching.

### 19. The web and mobile apps copy the same card rules

**Status:** to do

`apps/web/src/features/media/card-text.ts`, `apps/mobile/src/features/media/card-text.ts`, `packages/i18n/format.ts:93-102`

- **What this is:** card text, the "Resume S2 · E4" label (three copies), season picking and the language list exist in both apps.
- **Problem:** the copies have drifted already: `CardPlace` has `'search'` on the web only. The shared `formatRelative` calls `Intl.RelativeTimeFormat` without the guard Hermes (the mobile JavaScript engine) needs; the mobile app keeps its own guarded copy, so the next mobile caller of the shared one crashes.
- **Fix:** move the mobile `playLabelOf` and card-text helpers to `@projo/i18n/media`; put the guard in the shared `formatRelative` and delete the mobile copy.
- **If we skip it:** every rule change must be made two or three times.

## Nice to have

### 20. Dead code and duplicate helpers

**Status:** to do

- **What this is:** helpers nothing uses, or that copy shared ones.
- **Problem:**
  - unused: `isActive`, `isVideoSupported`, `pathExists` and the three segment payload types;
  - duplicates: `defaultAudioStream` repeats `chooseAudioStream`; `walk-root.ts` redefines `extensionOf` and `directoryOf`; `joinPath` exists three times next to `joinAbsolute`; `regularEpisodes` twice;
  - others: the re-export of `visible` in `catalog-repository.ts` has no importer; `readTrackRun` is used only by a test; the `jobs_finished_at_idx` index is never used alone.
- **Fix:** delete them or import the shared version; drop the index in a new migration.
- **If we skip it:** more code to read, and copies that drift.

## Summary

- **Verdict:** 1 first (one character, measured), then the three that lose data or leak a token (2, 3, 4).
- **Done:** 1 to 8 (2026-10-31, `21999f6`).
- **Left out:** 16 smaller findings, for example: a cancelled scan shows "Discovering N%" until the page reloads, a malformed deep link crashes the mobile card sheet, TMDB's "0 votes" sorts as a real rating, `tmdb_responses` is never purged.
- **Lean:** about −200 lines possible, no dependency to remove.
- **Not checked:** the audit ran neither the test suite nor the e2e tests. Not read line by line: the name parser (`core/naming/title.ts`, `analyze.ts`), fingerprint matching, the segment providers, most of the player UI on web and mobile, `runtime/scripts/`, and path behaviour on macOS mounts (Unicode forms, case).

## Still open from the review of 2026-10-26

Details in `git show 7ec1736:REVIEW.md`; the numbers are that review's. Status as of `7ec1736`, not checked again unless noted.

- 19 — The next episode closes fullscreen and Picture-in-Picture
- 26 — "Up next" forgets a show once its watched seasons are deleted
- 27 — Editing a library accepts a root that overlaps a kept symlinked root
- 30 — Six stores only grow
- 32 — Whoever reaches a fresh install first becomes its admin
- 34 — A library can stay "Scanning…" forever
- 40 — Safari does not retry while the keyframe index is not ready
- 45 — The image visibility check is optional (now part of 16)
- 46 — No test covers `X-Forwarded-For`
- 47 — The player's session lifecycle has no test
- 48 — The §21 performance test skips categories and restricted profiles (restricted profile added in `21999f6`; `/home/categories` still missing)
- 49 — No PWA at all (manifest added in `155e20f`; still no icons)
- 50 — Near-copies that must change together (partly 19 and 20)
- 51 — Dead code (partly 20)
- 53 — Invitation tokens appear in debug logs
- 54 — Search does not fold ligatures
- 55 — Trickplay sheets stay cached a day after regeneration
- 56 — Two database exports in the same second
- 58 — English shows "Cancel" where the spec says "Undo"
- 60 — The weekly refresh includes shows without any file
- 61 — §9.1 says the TMDB key is embedded; it is not
