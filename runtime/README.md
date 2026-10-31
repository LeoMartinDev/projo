# runtime/

projo's Docker image and its supervisor (PRODUCT.md §16). The image is a **runtime**: pinned Bun, `ffmpeg`, `ffprobe`, `fpcalc`, the supervisor. The application is a pure JS **bundle** installed in `/data/app/versions/<x.y.z>/`.

```
runtime/
  Dockerfile            # targets `runtime` (no app) and `app` (default: runtime + seed)
  entrypoint.sh         # hands /data over to the projo user then drops root
  VERSION               # runtime version (semver), exposed to the app
  supervisor/           # supervisor, Bun with no npm dependency, imports nothing from the monorepo
  scripts/build-bundle.ts     # dist/app/: the bundle and its manifest
  scripts/package-release.ts  # dist/release/: the three files of a release
  scripts/release-notes.ts    # release notes from the Conventional Commits
```

## Image

```bash
docker build -f runtime/Dockerfile -t projo:dev .                    # full image
docker build -f runtime/Dockerfile --target runtime -t projo-rt:dev . # runtime only
docker buildx build --platform linux/amd64,linux/arm64 -f runtime/Dockerfile .
```

- Base `debian:trixie-slim`, Bun copied from `oven/bun:<BUN_VERSION>-debian` (ARG, pinned to 1.4.4), `ffmpeg`, `libchromaprint-tools`, `tini`. Nothing architecture-specific.
- The bundle is built once on the build platform (`--platform=$BUILDPLATFORM`): it is universal.
- Changing Bun or ffmpeg = new image: bump `runtime/VERSION`.
- `ENTRYPOINT tini → entrypoint.sh → bun /opt/projo/supervisor/main.ts`. The container starts as root only to `chown` `/data` if it is not owned by `projo` (uid/gid 1000, a bind mount created by Docker), then `setpriv` to `projo`. The supervisor and the app never run as root. `--user` is honoured.
- `HEALTHCHECK`: `bun /opt/projo/supervisor/healthcheck.ts` → `GET http://127.0.0.1:$PORT/health`.
- In the image: `/opt/projo/{VERSION,supervisor/,app/}`, `app/` being the seed (bundle of the version published with the image).

## Supervisor

1. If `/data/app/current` is missing: copies the seed into `versions/<v>` (temporary folder, SHA-256 check against the manifest, `rename`), then creates `current -> versions/<v>` atomically. If `current` is broken, it is logged (`app/link_invalid`, `app/entry_missing`…) and the seed is reinstalled. A valid `current` always wins over the seed, even an older one.
2. Starts `bun /data/app/versions/<v>/server.js` (real path, not the link), `cwd` = that folder, stdout/stderr inherited.
3. Restarts the app if it exits: 1 s, 5 s, then 30 s; counter reset after 60 s of uptime.
4. `SIGTERM`/`SIGINT`: forwarded to the app, 25 s grace then `SIGKILL`; a second signal kills immediately. Exit 0. The compose file sets `stop_grace_period: 30s`.
5. JSON logs on stdout: `{ time, level, source: "supervisor", msg, code?, … }`.

Variables read: `PORT`, `DATA_DIR`, `LOG_LEVEL` (`TRUST_PROXY` is passed through as is). `PROJO_SEED_DIR` (internal) replaces `/opt/projo/app`, for development and tests.

## Application contract

- **Entry point**: `apps/server/src/entrypoints/main.ts`, bundled as `server.js` (`bun build --target=bun`, ESM, linked sourcemap). No native module: the script fails (`bundle/native_module`) otherwise.
- **Bundle** (`dist/app/`, published as `projo-app-<v>.tar.gz`):
  ```
  manifest.json   { version, runtimeMin, builtAt, files: { "<posix path>": "<sha256 hex>" } }
  server.js  server.js.map  [chunks/ assets/]
  public/         # copy of apps/web/dist
  drizzle/        # copy of apps/server/drizzle
  locales/        # optional, from apps/server/locales
  avatars/        # optional, from apps/server/avatars
  ```
  `files` covers every file except `manifest.json` and must contain `server.js`.
- **Assets and migrations**: relative to the entry file, `join(import.meta.dir, 'public')` and `join(import.meta.dir, 'drizzle')`. In development (not bundled), the app resolves its source paths itself.
- **Environment received**: `PORT`, `DATA_DIR`, `TRUST_PROXY`, `LOG_LEVEL`, plus `PROJO_RUNTIME_VERSION` (present only under the supervisor: the updater can use it to know it is active).
- **Lifecycle**: serve `/health` (200 = healthy); shut down cleanly in less than 25 s on `SIGTERM`; run migrations on startup and exit with a non-zero code on failure; exit code **75** requests a version switch (see below).
- **Bundle version**: `--version`, else `PROJO_VERSION`, else `version` of the root `package.json`. `runtimeMin`: `--runtime-min`, else `runtime/VERSION`.

```bash
bun runtime/scripts/build-bundle.ts [--out dist/app] [--version 1.2.3] [--runtime-min 0.1.0]
```

Requires `apps/web/dist` to be built already. The Dockerfile calls `bun run build:bundle` (root script: web build then this script).

## Version switch (M5, PRODUCT.md §16.3)

`switch.ts` (hooked by `supervisor.ts` on exit 75):

1. **Start**: reads then deletes `/data/app/pending` (the version alone, `1.4.0`). Without a valid version, or if it is the running version, the app is restarted as is (`update/pending_missing`). The requested version must be in `versions/<v>` and pass `verifyTree`; otherwise the switch is refused, report `rolled_back` (`invalid_version`).
2. **Database backup**: `db/projo.db` (and its `-wal`/`-shm` if they exist) copied to `db/backups/projo-<previous>.db`. The supervisor copies the files, it never opens the database. Failure: switch refused (`backup_failed`).
3. `current` repointed to the new version, which is started **without delay**; it has 60 s to answer `/health` (probed every second).
4. **Health OK**: `previous` → the old version, only these two are kept in `versions/`, and only this switch's database copy (`projo-<previous>.db`) in `db/backups/` (the app's pre-migration copies and exports are not touched), report `switched`.
5. **Otherwise** (timeout: `SIGTERM` then `SIGKILL` after 25 s; or exit before being healthy: `exited`; or container stop during the wait, or during steps 2–3 before the new version runs: `stopped`): `current` repointed to the old version, database restored from the backup (copied beside the live files as `projo.db.restore`, then the new version's `-wal`/`-shm` deleted and the copy renamed over `projo.db`, its `-wal` after it: a kill at any step leaves one version's database whole), old version restarted without delay, report `rolled_back` with `reason`. The refused version stays on disk (the app marks it `failed`; retention removes it on the next success).
6. A `pending` found when the supervisor starts (switch interrupted by a container stop) is deleted (`update/switch_interrupted`); the app closes the `update_runs` row left pending.

On Windows (development only), `pointLink` replaces the link with `unlink` then `rename`: Windows refuses to rename over a directory link, so the operation is not atomic there.

### Switch contract

- **App → supervisor**: the app installs the version in `versions/<v>` (verified), writes `/data/app/pending` (the version alone, `1.4.0`), shuts down cleanly (jobs put back in the queue without using an attempt, `apply_update` finished as `done`) then exits with **75**.
- **Supervisor → app**: after the switch (successful or rolled back), it has deleted `pending` and written `/data/app/switch-result.json`:
  ```json
  { "fromVersion": "1.3.2", "toVersion": "1.4.0", "outcome": "switched", "at": "2026-10-24T09:00:00.000Z" }
  ```
  `outcome`: `switched` (health OK within 60 s) or `rolled_back` (with `reason`: `health_timeout`, `exited`, `stopped`, `invalid_version`, `backup_failed`, `link_failed`). The app reads this file on startup, deletes it and updates `app_versions`, `update_runs` and notifications (`SwitchReport`, `apps/server/src/core/updates/update.ts`).

### Release expected by the updater (§16.2, §20)

On `github.com/LeoMartinDev/projo/releases`, tag `v<semver>`, three assets:

- `projo-app-<version>.tar.gz`: the bundle **at the root of the archive** (`manifest.json`, `server.js`, `public/…`; a `./` prefix is tolerated, no enclosing folder), regular files only (links ignored), no absolute path nor `..`;
- `manifest.json`: the same as in the archive;
- `SHA256SUMS`: `sha256sum` output (`<hex>  <name>`), with at least the archive and `manifest.json`.

The app only downloads asset URLs starting with `https://github.com/LeoMartinDev/projo/releases/download/`.

## Release in CI (PRODUCT.md §22)

Jobs `release-plan`, `runtime-image` and `release` of `.github/workflows/ci.yml`, on a tag, after `checks`, `test`, `e2e` and `docker`:

1. **`release-plan`**: tag `vX.Y.Z` = `version` of the root `package.json` (stable only), or `runtime-X.Y.Z` = `runtime/VERSION` on a commit whose app version is already published (`vX.Y.Z` exists). Previous tag: `git describe --match 'v[0-9]*' --exclude '*-*' HEAD^`. Image to push: `runtime-*` tag, first release, or image files changed since the previous tag (`runtime/` except `scripts/`, `README.md`, `tsconfig.json`, tests); in that last case `runtime/VERSION` must have changed (an image tag never changes content), otherwise failure.
2. **`runtime-image`** (if needed): `docker buildx` of the `app` target for `linux/amd64,linux/arm64`, `APP_VERSION` = app version (seed of `/opt/projo/app`), pushed as `ghcr.io/leomartindev/projo:<runtime/VERSION>` and `:latest` (`RUNTIME_IMAGE` in `apps/server/src/core/updates/update.ts`). The only job with `packages: write`.
3. **`release`** (`v*` tags, after the image: a release may require it through `runtimeMin`): `bun run build:bundle`, then

   ```bash
   bun runtime/scripts/package-release.ts --tag vX.Y.Z   # [--bundle dist/app] [--out dist/release]
   ```

   which rejects a bundle where a file is missing, differs or is not listed by the manifest, or which contains anything other than files, and a tag other than `v<manifest version>`. It writes `projo-app-X.Y.Z.tar.gz` (regular files at the root, written by `Bun.Archive`), `manifest.json` (byte-for-byte copy) and `SHA256SUMS`. CI then checks `SHA256SUMS` with `sha256sum --check`, installs the release with the app's real source and installer (`PROJO_RELEASE_DIR=dist/release bun test apps/server/test/integration/release-package.test.ts`), writes the notes (`release-notes.ts --tag --from <previous> --manifest --runtime-image`) and creates the release with `gh release create`. The only job with `contents: write`.

The notes group commits by type (breaking changes, `feat`, `fix`, `perf`, the rest), without merges or `chore(release)`, and end with the published image if there is one, `runtimeMin` and the compare link.

## Tests

```bash
bun test runtime/
tsc -p runtime/tsconfig.json
```

Fake processes and a manual clock for the restart policy and signals; real temporary folders for the seed and the version state; a fake repository for `build-bundle`.
