import { Database as SqliteClient } from 'bun:sqlite'
import { existsSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'

import { drizzle, type BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite'
import { migrate } from 'drizzle-orm/bun-sqlite/migrator'
import { type MigrationMeta, readMigrationFiles } from 'drizzle-orm/migrator'

import { appError, type AppError, err, ok, type Result } from '@projo/shared'

import type { Clock } from '../../core/clock.ts'
import type { Logger } from '../../core/logger.ts'
import * as schema from './schema/index.ts'

export type Db = BunSQLiteDatabase<typeof schema> & { $client: SqliteClient }

export type OpenDatabaseError = AppError<
  'db/open_failed' | 'db/migration_failed' | 'db/backup_failed'
>

type OpenDatabaseInput = {
  file: string
  migrationsDir: string
  backupsDir?: string
  clock: Clock
  logger: Logger
}

const configure = (client: SqliteClient): void => {
  client.run('PRAGMA journal_mode = WAL')
  client.run('PRAGMA synchronous = NORMAL')
  client.run('PRAGMA foreign_keys = ON')
  client.run('PRAGMA busy_timeout = 5000')
}

const release = (client: SqliteClient): void => {
  client.close(true)
}

const pendingMigrations = (client: SqliteClient, migrations: MigrationMeta[]): number => {
  const table = client
    .query<{ name: string }, []>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = '__drizzle_migrations'",
    )
    .get()
  if (table === null) return migrations.length
  const last = client
    .query<{ last: number | null }, []>('SELECT MAX(created_at) AS last FROM __drizzle_migrations')
    .get()
  const lastApplied = last?.last ?? 0
  return migrations.filter((migration) => migration.folderMillis > lastApplied).length
}

const backupFileName = (now: Date): string =>
  `projo-${now.toISOString().replaceAll(':', '-').replace('.', '-')}-pre-migration.db`

const KEPT_MIGRATION_BACKUPS = 2

const pruneMigrationBackups = (backupsDir: string, logger: Logger): void => {
  try {
    const copies = readdirSync(backupsDir)
      .filter((name) => name.startsWith('projo-') && name.endsWith('-pre-migration.db'))
      .sort()
    for (const name of copies.slice(0, -KEPT_MIGRATION_BACKUPS)) {
      rmSync(join(backupsDir, name), { force: true })
      logger.info('old pre-migration backup removed', { backupFile: name })
    }
  } catch (cause) {
    logger.warn('cannot remove old pre-migration backups', { backupsDir, error: cause })
  }
}

export const openDatabase = ({
  file,
  migrationsDir,
  backupsDir,
  clock,
  logger,
}: OpenDatabaseInput): Result<Db, OpenDatabaseError> => {
  const existed = file !== ':memory:' && existsSync(file)

  let client: SqliteClient
  try {
    client = new SqliteClient(file, { create: true, strict: true })
    configure(client)
  } catch (cause) {
    return err(appError('db/open_failed', 'cannot open database', { context: { file }, cause }))
  }

  let migrations: MigrationMeta[]
  try {
    migrations = readMigrationFiles({ migrationsFolder: migrationsDir })
  } catch (cause) {
    release(client)
    return err(
      appError('db/migration_failed', 'cannot read migrations', {
        context: { migrationsDir },
        cause,
      }),
    )
  }

  const pending = pendingMigrations(client, migrations)

  if (existed && pending > 0 && backupsDir !== undefined) {
    const backupFile = join(backupsDir, backupFileName(clock.now()))
    try {
      client.run('VACUUM INTO ?', [backupFile])
      logger.info('database backed up before migration', { backupFile, pending })
    } catch (cause) {
      release(client)
      return err(
        appError('db/backup_failed', 'cannot back up database before migration', {
          context: { backupFile },
          cause,
        }),
      )
    }
    pruneMigrationBackups(backupsDir, logger)
  }

  const db = drizzle({ client, schema, casing: 'snake_case' })

  if (pending > 0) {
    let violations: unknown[]
    try {
      client.run('PRAGMA foreign_keys = OFF')
      migrate(db, { migrationsFolder: migrationsDir })
      violations = client.query('PRAGMA foreign_key_check').all()
    } catch (cause) {
      release(client)
      return err(appError('db/migration_failed', 'database migration failed', { cause }))
    }
    if (violations.length > 0) {
      release(client)
      return err(
        appError('db/migration_failed', 'database migration left foreign key violations', {
          context: { count: violations.length, violations: violations.slice(0, 10) },
        }),
      )
    }
    client.run('PRAGMA foreign_keys = ON')
    logger.info('database migrated', { applied: pending })
  }

  return ok(db)
}

export const closeDatabase = (db: Db): void => {
  release(db.$client)
}
