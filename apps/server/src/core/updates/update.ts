import type { AppError, Result } from '@projo/shared'
import type { AppVersionState, UpdateState } from '@projo/shared/api/updates'

/**
 * §16 Updates, application side. The supervisor (`runtime/supervisor/`, no import from the
 * monorepo) owns the switch; the app finds, downloads and checks a release, writes
 * `/data/app/pending` and exits 75. Types and ports only; the use cases live in
 * `application/updates/`.
 */

export type { AppVersionState, UpdateState }

/** Only source of releases (§16.2, §20). */
export const RELEASES_REPOSITORY = 'LeoMartinDev/projo'

/** Docker image of the runtime (§24), for the `docker pull` of `update/runtime_too_old`. */
export const RUNTIME_IMAGE = 'ghcr.io/leomartindev/projo'

/** What the admin runs before an update that needs a newer runtime (§16.4). */
export const RUNTIME_PULL_COMMAND = `docker pull ${RUNTIME_IMAGE}:latest`

/** Exit code that asks the supervisor for a switch to the version in `/data/app/pending` (§16.3). */
export const SWITCH_EXIT_CODE = 75

/** Archive name of a release (§16.2). */
export const releaseArchiveName = (version: string): string => `projo-app-${version}.tar.gz`
export const RELEASE_CHECKSUMS_NAME = 'SHA256SUMS'
export const RELEASE_MANIFEST_NAME = 'manifest.json'

export type ReleaseAsset = { name: string; url: string; sizeBytes: number }

/** The latest GitHub release of the channel (`/releases/latest`), validated by Zod in the adapter. */
export type Release = {
  /** Semver, without the `v` of the tag. */
  version: string
  tag: string
  publishedAt: Date
  notes: string
  /** Release page on github.com. */
  url: string
  archive: ReleaseAsset
  checksums: ReleaseAsset
  /**
   * `runtimeMin` of the release's `manifest.json`, read by the check from the `manifest.json` asset
   * published next to the archive (§16.2; also inside the archive, both listed in `SHA256SUMS`).
   */
  runtimeMin: string
}

/** `manifest.json` of an app bundle (§16.2, runtime/README.md). */
export type ReleaseManifest = {
  version: string
  runtimeMin: string
  builtAt: Date
  /** POSIX path relative to the bundle → SHA-256 hex. Every file except `manifest.json`. */
  files: Record<string, string>
}

/** A row of `app_versions` (§6.5). */
export type AppVersion = {
  version: string
  state: AppVersionState
  installedAt: Date
  runtimeMin: string
}

export type UpdateRunKind = 'update' | 'rollback'
export type UpdateRunOutcome = 'pending' | 'succeeded' | 'failed' | 'rolled_back'

/** A row of `update_runs`: the update log (§15). */
export type UpdateRun = {
  id: string
  kind: UpdateRunKind
  fromVersion: string
  toVersion: string
  requestedAt: Date
  finishedAt?: Date
  outcome: UpdateRunOutcome
  error?: Pick<AppError, 'code' | 'message'>
}

/** What the last `check_updates` found (`settings.updates.last_check`). */
export type UpdateCheckRecord = {
  checkedAt: Date
  /** The latest release of the channel, newer or not than the running version. */
  latest?: Release
  error?: Pick<AppError, 'code' | 'message'>
}

/**
 * What the supervisor reports about the last switch, written next to `pending`
 * (`/data/app/switch-result.json`) and consumed once by the app at startup: it settles the
 * pending `update_runs` row, `app_versions` and the `update/rolled_back` notification (the
 * supervisor never writes the database: its schema belongs to the app versions).
 */
export type SwitchReport = {
  fromVersion: string
  toVersion: string
  outcome: 'switched' | 'rolled_back'
  at: Date
  /** Why it went back (`health_timeout`, `exited`…), for the notification. */
  reason?: string
}

/** Payloads of the §18 jobs (Zod schemas in `entrypoints/modules/updates.ts`). */
export type CheckUpdatesPayload = Record<string, never>
export type ApplyUpdatePayload = { version: string }

// ── Errors ───────────────────────────────────────────────────────────────────

export type ReleaseSourceError = AppError<'update/check_failed' | 'update/invalid_release'>

export type InstallReleaseError = AppError<
  | 'update/download_failed'
  | 'update/checksum_mismatch'
  | 'update/invalid_release'
  | 'update/install_failed'
>

// ── Ports ────────────────────────────────────────────────────────────────────

/** GitHub Releases of `RELEASES_REPOSITORY` (HTTP adapter, injectable base URL for the tests). */
export type ReleaseSource = {
  /** The latest release of the channel; `undefined` when the repository has none. */
  latest: (input: { channel: 'stable' }) => Promise<Result<Release | undefined, ReleaseSourceError>>
}

/**
 * The files under `/data/app` (§5.4) the app may touch: `staging/`, `versions/`, `pending`,
 * `switch-result.json`. `current` and `previous` belong to the supervisor.
 */
export type ReleaseInstaller = {
  /**
   * Downloads the archive and `SHA256SUMS` into `staging/<v>`, checks the archive against
   * `SHA256SUMS`, extracts it, checks every file against the manifest, then renames it to
   * `versions/<v>` (§16.4, §20). Downloads only from github.com (§20). `staging/<v>` is removed
   * whatever the outcome.
   */
  install: (input: {
    release: Release
    signal: AbortSignal
    onProgress: (percent: number) => void
  }) => Promise<Result<ReleaseManifest, InstallReleaseError>>
  /** Versions present in `versions/` whose manifest and files check out (rollback targets). */
  installed: () => Promise<{ version: string; manifest: ReleaseManifest }[]>
  /** Writes `/data/app/pending` (a version) before the exit 75. */
  writePending: (version: string) => Promise<Result<void, AppError<'update/install_failed'>>>
  /** Reads then deletes `switch-result.json`; `undefined` when absent or unreadable. */
  takeSwitchReport: () => Promise<SwitchReport | undefined>
}

/** `app_versions` and `update_runs` (§6.5). Synchronous (bun:sqlite). */
export type UpdateRepository = {
  /** Newest first (semver). */
  versions: () => AppVersion[]
  upsertVersion: (version: AppVersion) => void
  setVersionState: (input: { version: string; state: AppVersionState }) => void
  startRun: (run: Omit<UpdateRun, 'outcome' | 'finishedAt' | 'error'>) => UpdateRun
  finishRun: (input: {
    id: string
    outcome: Exclude<UpdateRunOutcome, 'pending'>
    finishedAt: Date
    error?: Pick<AppError, 'code' | 'message'>
  }) => UpdateRun | undefined
  /** The `pending` run, if any (one at a time). */
  pendingRun: () => UpdateRun | undefined
  /** Newest first. */
  recentRuns: (limit: number) => UpdateRun[]
}

/** `settings.updates.last_check`. */
export type UpdateCheckStore = {
  read: () => UpdateCheckRecord | undefined
  write: (record: UpdateCheckRecord) => void
}

/**
 * The running process as the updater sees it. `enabled`: under the supervisor
 * (`PROJO_RUNTIME_VERSION` set) and from the bundle (§16.4: off in `bun run dev`).
 */
export type ProcessControl = {
  enabled: boolean
  appVersion: string
  runtimeVersion: string
  /**
   * Stops the server cleanly (same path as `SIGTERM`: jobs released, sessions ended, database
   * closed) then exits with `SWITCH_EXIT_CODE`. Returns at once; the exit follows the response.
   */
  exitForSwitch: () => void
}

/** Live updater state, kept in memory and published as `update.state` (§17.1). */
export type UpdateStateHolder = {
  current: () => { state: UpdateState; version?: string; progress?: number }
  set: (input: { state: UpdateState; version?: string; progress?: number }) => void
}
