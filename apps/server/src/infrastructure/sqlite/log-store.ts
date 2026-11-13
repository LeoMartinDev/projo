import { Database as SqliteClient } from 'bun:sqlite'

import { type Logger, type LogLevel, levelWeight, logLevels } from '../../core/logger.ts'
import type { LogEntry, LogQuery, LogRecord, LogStore } from '../../core/logs/log.ts'

/**
 * The log lines kept for the viewer (§15), in their own SQLite file (`/data/logs/logs.db`): the
 * main database, its backups and its exports never carry them, and writing them never waits on
 * a catalogue transaction. Plain `bun:sqlite`, no migrations: one table, versioned by
 * `user_version`.
 */
export type SqliteLogStore = LogStore & {
  /** The file in use, `:memory:` when the file could not be opened. */
  file: string
  close: () => void
}

const schemaVersion = 1

const setUp = (client: SqliteClient): void => {
  // `auto_vacuum` only applies when set before the first table is created.
  client.run('PRAGMA auto_vacuum = INCREMENTAL')
  client.run('PRAGMA journal_mode = WAL')
  client.run('PRAGMA synchronous = NORMAL')
  client.run('PRAGMA busy_timeout = 5000')
  const version = client.query<{ user_version: number }, []>('PRAGMA user_version').get()
  if ((version?.user_version ?? 0) < schemaVersion) {
    client.run('DROP TABLE IF EXISTS log_lines')
  }
  client.run(`CREATE TABLE IF NOT EXISTS log_lines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    time TEXT NOT NULL,
    level INTEGER NOT NULL,
    message TEXT NOT NULL,
    code TEXT,
    fields TEXT NOT NULL
  )`)
  client.run('CREATE INDEX IF NOT EXISTS log_lines_time ON log_lines (time)')
  client.run(`PRAGMA user_version = ${schemaVersion}`)
}

const openClient = (file: string): SqliteClient => {
  const client = new SqliteClient(file, { create: true, strict: true })
  try {
    setUp(client)
    return client
  } catch (cause) {
    client.close(true)
    throw cause
  }
}

type Row = {
  id: number
  time: string
  level: number
  message: string
  code: string | null
  fields: string
}

const levelOf = (weight: number): LogLevel =>
  logLevels.find((level) => levelWeight[level] === weight) ?? 'info'

const parseFields = (text: string): Record<string, unknown> => {
  try {
    const value: unknown = JSON.parse(text)
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

const toEntry = (row: Row): LogEntry => ({
  id: String(row.id),
  time: new Date(row.time),
  level: levelOf(row.level),
  message: row.message,
  ...(row.code === null ? {} : { code: row.code }),
  fields: parseFields(row.fields),
})

const likePattern = (text: string): string => `%${text.replace(/[\\%_]/g, (char) => `\\${char}`)}%`

const stringifyFields = (fields: Record<string, unknown>): string => {
  try {
    return JSON.stringify(fields)
  } catch {
    return '{}'
  }
}

const createStore = (client: SqliteClient, file: string): SqliteLogStore => {
  const insert = client.prepare<unknown, [string, number, string, string | null, string]>(
    'INSERT INTO log_lines (time, level, message, code, fields) VALUES (?, ?, ?, ?, ?)',
  )
  const appendAll = client.transaction((records: readonly LogRecord[]) => {
    for (const record of records) {
      insert.run(
        record.time.toISOString(),
        levelWeight[record.level],
        record.message,
        record.code ?? null,
        stringifyFields(record.fields),
      )
    }
  })

  const list = ({ minLevel, from, to, text, order = 'desc', cursor, limit }: LogQuery) => {
    const where: string[] = []
    const params: (string | number)[] = []
    if (minLevel !== undefined && minLevel !== 'debug') {
      where.push('level >= ?')
      params.push(levelWeight[minLevel])
    }
    if (from !== undefined) {
      where.push('time >= ?')
      params.push(from.toISOString())
    }
    if (to !== undefined) {
      where.push('time <= ?')
      params.push(to.toISOString())
    }
    if (text !== undefined && text.trim() !== '') {
      const pattern = likePattern(text.trim())
      where.push(
        "(message LIKE ? ESCAPE '\\' OR code LIKE ? ESCAPE '\\' OR fields LIKE ? ESCAPE '\\')",
      )
      params.push(pattern, pattern, pattern)
    }
    const after = cursor === undefined ? Number.NaN : Number(cursor)
    if (Number.isInteger(after)) {
      where.push(order === 'asc' ? 'id > ?' : 'id < ?')
      params.push(after)
    }
    const sql = `SELECT id, time, level, message, code, fields FROM log_lines${
      where.length === 0 ? '' : ` WHERE ${where.join(' AND ')}`
    } ORDER BY id ${order === 'asc' ? 'ASC' : 'DESC'} LIMIT ?`
    const rows = client.query<Row, (string | number)[]>(sql).all(...params, limit + 1)
    const items = rows.slice(0, limit).map(toEntry)
    const last = items.at(-1)
    return {
      items,
      ...(rows.length > limit && last !== undefined ? { nextCursor: last.id } : {}),
    }
  }

  const purge = ({ before, keep }: { before: Date; keep: number }): number => {
    const old = client.query('DELETE FROM log_lines WHERE time < ?').run(before.toISOString())
    const beyond = client
      .query(
        'DELETE FROM log_lines WHERE id <= (SELECT id FROM log_lines ORDER BY id DESC LIMIT 1 OFFSET ?)',
      )
      .run(keep)
    const removed = old.changes + beyond.changes
    if (removed > 0) client.run('PRAGMA incremental_vacuum')
    return removed
  }

  return {
    file,
    append: (records) => {
      if (records.length > 0) appendAll(records)
    },
    list,
    purge,
    close: () => {
      insert.finalize()
      client.close(true)
    },
  }
}

/**
 * Opens the log store; when the file cannot be opened (unreadable, corrupt, full disk), keeps the
 * lines of this run in memory instead and says so: the viewer must never stop the server.
 */
export const openSqliteLogStore = ({
  file,
  logger,
}: {
  file: string
  logger: Logger
}): SqliteLogStore => {
  try {
    return createStore(openClient(file), file)
  } catch (cause) {
    logger.error('log store unavailable, keeping this run in memory', {
      code: 'logs/store_unavailable',
      file,
      error: cause,
    })
    return createStore(openClient(':memory:'), ':memory:')
  }
}
