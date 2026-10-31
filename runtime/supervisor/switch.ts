import { copyFile, mkdir, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { Clock } from './clock'
import { errorFields, type Logger } from './logger'
import { verifyTree } from './manifest'
import { isSemVer } from './semver'
import {
  pointLink,
  readAppState,
  readInstalledVersion,
  versionDir,
  type AppLayout,
  type InstalledVersion,
} from './version-state'

/** PRODUCT.md §16.3: the new version has this long to answer `/health`. */
export const SWITCH_HEALTH_TIMEOUT_MS = 60_000
export const SWITCH_HEALTH_INTERVAL_MS = 1_000

/** Database files of `/data/db` (§5.4); the supervisor copies them, it never opens the database. */
export type DbLayout = { file: string; backupsDir: string }

export const dbLayout = (dataDir: string): DbLayout => ({
  file: join(resolve(dataDir), 'db', 'projo.db'),
  backupsDir: join(resolve(dataDir), 'db', 'backups'),
})

/** A switch in flight: `current` already points to `to`, waiting for `/health`. */
export type PendingSwitch = {
  from: string
  to: string
  /** Copy of the database taken before the switch; absent when there was no database yet. */
  backup?: string
}

export type RollbackReason = 'health_timeout' | 'exited' | 'stopped'

/** `/data/app/switch-result.json`, read once by the app at startup (runtime/README.md). */
export type SwitchReport = {
  fromVersion: string
  toVersion: string
  outcome: 'switched' | 'rolled_back'
  at: string
  reason?: string
}

export type SwitchHandler = {
  /**
   * Exit 75: reads `pending`, backs the database up, points `current` to the new version.
   * `undefined` when there is nothing to switch to (relaunch as is; a report says why).
   */
  begin: (from: InstalledVersion) => Promise<PendingSwitch | undefined>
  /** The new version answered `/health`: `previous`, retention, report. */
  confirm: (pending: PendingSwitch) => Promise<void>
  /** The new version failed: `current` back, database restored, report. */
  rollback: (pending: PendingSwitch, reason: RollbackReason) => Promise<void>
}

/** SQLite's companions of the main file (WAL mode). */
const DB_SIDE_FILES = ['-wal', '-shm'] as const

const exists = async (path: string): Promise<boolean> =>
  stat(path).then(
    () => true,
    () => false,
  )

const describe = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause)

export const switchHandlerFactory = ({
  layout,
  db,
  clock,
  logger,
}: {
  layout: AppLayout
  db: DbLayout
  clock: Clock
  logger: Logger
}): SwitchHandler => {
  const switchResultFile = join(layout.appDir, 'switch-result.json')

  const writeReport = async (report: Omit<SwitchReport, 'at'>): Promise<void> => {
    const tmp = `${switchResultFile}.tmp`
    const content: SwitchReport = { ...report, at: new Date(clock.now()).toISOString() }
    try {
      await writeFile(tmp, `${JSON.stringify(content)}\n`, 'utf8')
      await rename(tmp, switchResultFile)
    } catch (cause) {
      logger.error('cannot write the switch report', {
        code: 'update/report_failed',
        error: describe(cause),
      })
    }
  }

  const removePending = async (): Promise<void> => {
    await rm(layout.pendingFile, { force: true }).catch(() => undefined)
  }

  /** `projo.db` (and its WAL files when present) → `db/backups/projo-<from>.db[-wal]`. */
  const backupDatabase = async (from: string): Promise<string | undefined> => {
    if (!(await exists(db.file))) return undefined
    await mkdir(db.backupsDir, { recursive: true })
    const backup = join(db.backupsDir, `projo-${from}.db`)
    await rm(backup, { force: true })
    await copyFile(db.file, backup)
    for (const suffix of DB_SIDE_FILES) {
      await rm(`${backup}${suffix}`, { force: true })
      if (await exists(`${db.file}${suffix}`))
        await copyFile(`${db.file}${suffix}`, `${backup}${suffix}`)
    }
    return backup
  }

  /**
   * Copies first, beside the live files, then swaps with `rename`: a kill at any step leaves the
   * new version's database or the old one, never one's journal replayed onto the other. `-shm`
   * is not restored: SQLite rebuilds it from the `-wal`.
   */
  const restoreDatabase = async (backup: string): Promise<void> => {
    const restored = `${db.file}.restore`
    await copyFile(backup, restored)
    await rm(`${restored}-wal`, { force: true })
    const withWal = await exists(`${backup}-wal`)
    if (withWal) await copyFile(`${backup}-wal`, `${restored}-wal`)
    for (const suffix of DB_SIDE_FILES) await rm(`${db.file}${suffix}`, { force: true })
    await rename(restored, db.file)
    if (withWal) await rename(`${restored}-wal`, `${db.file}-wal`)
  }

  /** `projo-<version>.db[-wal|-shm]` of earlier switches; the app's own copies are left alone. */
  const pruneBackups = async (keep: string): Promise<void> => {
    const names = await readdir(db.backupsDir).catch(() => [] as string[])
    for (const name of names) {
      const version = /^projo-(.+)\.db(?:-wal|-shm)?$/u.exec(name)?.[1]
      if (version === undefined || version === keep || !isSemVer(version)) continue
      await rm(join(db.backupsDir, name), { force: true }).then(
        () => logger.info('old database backup removed', { file: name }),
        (cause: unknown) =>
          logger.warn('cannot remove an old database backup', {
            file: name,
            error: describe(cause),
          }),
      )
    }
  }

  /** Keeps `keep` (current and previous); removes every other version directory. */
  const pruneVersions = async (keep: readonly string[]): Promise<void> => {
    const { installed } = await readAppState(layout)
    for (const version of installed) {
      if (keep.includes(version)) continue
      await rm(versionDir(layout, version), { recursive: true, force: true }).then(
        () => logger.info('old app version removed', { version }),
        (cause: unknown) =>
          logger.warn('cannot remove an old app version', { version, error: describe(cause) }),
      )
    }
  }

  const refuse = async (from: string, to: string, reason: string): Promise<undefined> => {
    await removePending()
    await writeReport({ fromVersion: from, toVersion: to, outcome: 'rolled_back', reason })
    return undefined
  }

  return {
    begin: async (from) => {
      const { pending } = await readAppState(layout)
      // Consumed at once: a later boot must not see it again, whatever happens next.
      await removePending()
      if (pending === undefined || !isSemVer(pending)) {
        logger.warn('switch requested without a valid pending version: relaunching', {
          code: 'update/pending_missing',
          pending,
        })
        return undefined
      }
      if (pending === from.version) {
        logger.warn('switch requested to the running version: relaunching', { version: pending })
        return undefined
      }

      const target = await readInstalledVersion(layout, pending)
      const verified = target.ok
        ? await verifyTree(target.value.dir, target.value.manifest)
        : target
      if (!verified.ok) {
        logger.error('requested version is not installed correctly: switch refused', {
          ...errorFields(verified.error),
          from: from.version,
          to: pending,
        })
        return refuse(from.version, pending, 'invalid_version')
      }

      let backup: string | undefined
      try {
        backup = await backupDatabase(from.version)
      } catch (cause) {
        logger.error('cannot back the database up: switch refused', {
          code: 'update/backup_failed',
          error: describe(cause),
        })
        return refuse(from.version, pending, 'backup_failed')
      }
      const linked = await pointLink(layout, 'current', pending)
      if (!linked.ok) {
        logger.error(
          'cannot point current to the new version: switch refused',
          errorFields(linked.error),
        )
        return refuse(from.version, pending, 'link_failed')
      }
      logger.info('switching app version', { from: from.version, to: pending, backup })
      return { from: from.version, to: pending, ...(backup === undefined ? {} : { backup }) }
    },

    confirm: async ({ from, to }) => {
      const linked = await pointLink(layout, 'previous', from)
      if (!linked.ok)
        logger.warn('cannot point previous to the old version', errorFields(linked.error))
      await pruneVersions([to, from])
      // Keeps the copy taken before this switch: the database `previous` last ran on.
      await pruneBackups(from)
      await removePending()
      await writeReport({ fromVersion: from, toVersion: to, outcome: 'switched' })
      logger.info('app version switched', { code: 'update/switched', from, to })
    },

    rollback: async ({ from, to, backup }, reason) => {
      const linked = await pointLink(layout, 'current', from)
      if (!linked.ok)
        logger.error('cannot point current back to the old version', errorFields(linked.error))
      if (backup !== undefined) {
        try {
          await restoreDatabase(backup)
        } catch (cause) {
          logger.error('cannot restore the database backup', {
            code: 'update/restore_failed',
            backup,
            error: describe(cause),
          })
        }
      }
      await removePending()
      await writeReport({ fromVersion: from, toVersion: to, outcome: 'rolled_back', reason })
      logger.error('app version switch rolled back', {
        code: 'update/rolled_back',
        from,
        to,
        reason,
      })
    },
  }
}
