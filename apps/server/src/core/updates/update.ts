import type { AppError, Result } from '@projo/shared'
import type { AppVersionState, UpdateState } from '@projo/shared/api/updates'

export type { AppVersionState, UpdateState }

export const RELEASES_REPOSITORY = 'LeoMartinDev/projo'

export const RUNTIME_IMAGE = 'ghcr.io/leomartindev/projo'

export const RUNTIME_PULL_COMMAND = `docker pull ${RUNTIME_IMAGE}:latest`

export const SWITCH_EXIT_CODE = 75

export const releaseArchiveName = (version: string): string => `projo-app-${version}.tar.gz`
export const RELEASE_CHECKSUMS_NAME = 'SHA256SUMS'
export const RELEASE_MANIFEST_NAME = 'manifest.json'

export type ReleaseAsset = { name: string; url: string; sizeBytes: number }

export type Release = {
  version: string
  tag: string
  publishedAt: Date
  notes: string
  url: string
  archive: ReleaseAsset
  checksums: ReleaseAsset
  runtimeMin: string
}

export type ReleaseManifest = {
  version: string
  runtimeMin: string
  builtAt: Date
  files: Record<string, string>
}

export type AppVersion = {
  version: string
  state: AppVersionState
  installedAt: Date
  runtimeMin: string
}

export type UpdateRunKind = 'update' | 'rollback'
export type UpdateRunOutcome = 'pending' | 'succeeded' | 'failed' | 'rolled_back'

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

export type UpdateCheckRecord = {
  checkedAt: Date
  latest?: Release
  error?: Pick<AppError, 'code' | 'message'>
}

export type SwitchReport = {
  fromVersion: string
  toVersion: string
  outcome: 'switched' | 'rolled_back'
  at: Date
  reason?: string
}

export type CheckUpdatesPayload = Record<string, never>
export type ApplyUpdatePayload = { version: string }

export type ReleaseSourceError = AppError<'update/check_failed' | 'update/invalid_release'>

export type InstallReleaseError = AppError<
  | 'update/download_failed'
  | 'update/checksum_mismatch'
  | 'update/invalid_release'
  | 'update/install_failed'
>

export type ReleaseSource = {
  latest: (input: { channel: 'stable' }) => Promise<Result<Release | undefined, ReleaseSourceError>>
}

export type ReleaseInstaller = {
  install: (input: {
    release: Release
    signal: AbortSignal
    onProgress: (percent: number) => void
  }) => Promise<Result<ReleaseManifest, InstallReleaseError>>
  installed: () => Promise<{ version: string; manifest: ReleaseManifest }[]>
  writePending: (version: string) => Promise<Result<void, AppError<'update/install_failed'>>>
  takeSwitchReport: () => Promise<SwitchReport | undefined>
}

export type UpdateRepository = {
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
  pendingRun: () => UpdateRun | undefined
  recentRuns: (limit: number) => UpdateRun[]
}

export type UpdateCheckStore = {
  read: () => UpdateCheckRecord | undefined
  write: (record: UpdateCheckRecord) => void
}

export type ProcessControl = {
  enabled: boolean
  appVersion: string
  runtimeVersion: string
  exitForSwitch: () => void
}

export type UpdateStateHolder = {
  current: () => { state: UpdateState; version?: string; progress?: number }
  set: (input: { state: UpdateState; version?: string; progress?: number }) => void
}
