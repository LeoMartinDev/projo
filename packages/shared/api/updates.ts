import { z } from 'zod'

import { isoDateTimeSchema } from './common.ts'

/**
 * §16 Updates, §15 "Updates", §17.2: `GET /admin/updates`, `POST /admin/updates/check`,
 * `POST /admin/updates/apply`, `POST /admin/updates/rollback`. Live state: SSE `update.state`.
 */

const semverSchema = z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u, {
  message: 'expected a semver version such as 1.4.0',
})

/**
 * Live state of the updater (`update.state` SSE, `GET /admin/updates`):
 * - `idle`: nothing newer known; `checking`: `check_updates` running;
 * - `available`: a newer release is known (compatible or not with the runtime);
 * - `downloading`: `apply_update` downloads and verifies (`progress`);
 * - `applying`: extracted, `pending` written; `restarting`: the server exits 75 for the switch;
 * - `failed`: the last check or update failed (`GET /admin/updates` carries the error).
 */
export const updateStateSchema = z.enum([
  'idle',
  'checking',
  'available',
  'downloading',
  'applying',
  'restarting',
  'failed',
])
export type UpdateState = z.infer<typeof updateStateSchema>

/** `app_versions.state` (§6.5). */
export const appVersionStateSchema = z.enum(['current', 'previous', 'failed', 'staged'])
export type AppVersionState = z.infer<typeof appVersionStateSchema>

/** The latest release of the `stable` channel (GitHub Releases, §16.2), when newer than current. */
export const releaseDtoSchema = z.object({
  version: semverSchema,
  publishedAt: isoDateTimeSchema,
  /** GitHub release notes (Markdown source, shown as text). */
  notes: z.string(),
  /** Release page on github.com. */
  url: z.string(),
  runtimeMin: semverSchema,
  /**
   * `runtimeMin` ≤ running runtime: "Update" is offered. Otherwise `pullCommand` is the
   * `docker pull` to run first (§16.4), and apply answers 409 `update/runtime_too_old`.
   */
  runtimeCompatible: z.boolean(),
  pullCommand: z.string().optional(),
})
export type ReleaseDto = z.infer<typeof releaseDtoSchema>

/**
 * A version known to the server (`app_versions`): the current one, the previous one kept for a
 * rollback, a failed one. `canSwitch`: its directory is on the disk and valid, it is not current,
 * and its `runtimeMin` fits the runtime ("Go back to this version").
 */
export const appVersionDtoSchema = z.object({
  version: semverSchema,
  state: appVersionStateSchema,
  installedAt: isoDateTimeSchema,
  runtimeMin: semverSchema,
  canSwitch: z.boolean(),
})
export type AppVersionDto = z.infer<typeof appVersionDtoSchema>

/**
 * One line of the update log (§15 "update log", `update_runs`): an update or a
 * rollback, from its request to its outcome. `pending`: requested, the switch not confirmed yet;
 * `succeeded`: the new version answered `/health`; `failed`: stopped before the switch (download,
 * checksum…); `rolled_back`: the supervisor went back to `fromVersion` (§16.3).
 */
export const updateRunDtoSchema = z.object({
  id: z.string(),
  kind: z.enum(['update', 'rollback']),
  fromVersion: semverSchema,
  toVersion: semverSchema,
  requestedAt: isoDateTimeSchema,
  finishedAt: isoDateTimeSchema.optional(),
  outcome: z.enum(['pending', 'succeeded', 'failed', 'rolled_back']),
  error: z.object({ code: z.string(), message: z.string() }).optional(),
})
export type UpdateRunDto = z.infer<typeof updateRunDtoSchema>

/** `GET /admin/updates`. */
export const updatesStatusDtoSchema = z.object({
  /**
   * `false` in development (`bun run dev`) or without the supervisor: the screen shows the
   * versions, the buttons are off (the actions answer 409 `update/disabled`).
   */
  enabled: z.boolean(),
  current: z.object({ version: z.string(), runtime: z.string() }),
  /** Only `stable` in v1 (`settings.update_channel` exists for v2, §16.4). */
  channel: z.literal('stable'),
  state: updateStateSchema,
  /** `downloading`: 0–100. */
  progress: z.number().min(0).max(100).optional(),
  lastCheckedAt: isoDateTimeSchema.optional(),
  /** The last check failed (`update/check_failed`, `update/invalid_release`). */
  lastCheckError: z.object({ code: z.string(), message: z.string() }).optional(),
  available: releaseDtoSchema.optional(),
  /** Newest first. */
  versions: z.array(appVersionDtoSchema),
  /** The 20 latest runs, newest first. */
  runs: z.array(updateRunDtoSchema),
})
export type UpdatesStatusDto = z.infer<typeof updatesStatusDtoSchema>

/** `POST /admin/updates/check`: 202 `{ jobId }` (`check_updates`), then `update.state`. */

/**
 * `POST /admin/updates/apply`: the version shown as available (a guard against a release published
 * in between). 202 `{ jobId }` (`apply_update`); errors: `update/disabled`, `update/not_found`,
 * `update/already_current`, `update/runtime_too_old`, `update/in_progress`.
 */
export const applyUpdateBodySchema = z.object({ version: semverSchema })
export type ApplyUpdateBody = z.infer<typeof applyUpdateBodySchema>

/**
 * `POST /admin/updates/rollback`: switch to a version present on the disk (§16.4 "Go back to this
 * version"). 202 then the server exits 75 and the supervisor switches; the web waits for
 * `/health` to answer that version. Errors: `update/disabled`, `update/not_found`,
 * `update/already_current`, `update/runtime_too_old`, `update/in_progress`.
 */
export const rollbackBodySchema = z.object({ version: semverSchema })
export type RollbackBody = z.infer<typeof rollbackBodySchema>

export const rollbackResponseSchema = z.object({ version: semverSchema })
export type RollbackResponse = z.infer<typeof rollbackResponseSchema>
