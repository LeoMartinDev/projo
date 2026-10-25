import { afterEach, describe, expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { createTempDir } from '../../test/support/database.ts'
import { resolveAppPaths } from './app-paths.ts'
import { startProjo } from './main.ts'

describe('startProjo', () => {
  let temp: ReturnType<typeof createTempDir>
  afterEach(() => temp.cleanup())

  test('creates the data layout, migrates, serves /health and stops cleanly', async () => {
    temp = createTempDir()
    const startedAt = performance.now()
    const started = startProjo({
      env: { PORT: '0', DATA_DIR: temp.path, LOG_LEVEL: 'error' },
      appPaths: resolveAppPaths(import.meta.dir),
    })
    if (!started.ok) throw new Error(started.error.message)

    const response = await fetch(new URL('/health', started.value.url))
    expect(performance.now() - startedAt).toBeLessThan(3_000)
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ status: 'ok', runtime: 'dev' })

    for (const dir of [
      'db/backups',
      'images/posters',
      'cache/transcode',
      'cache/keyframes',
      'app/versions',
    ]) {
      expect(existsSync(join(temp.path, dir))).toBe(true)
    }
    expect(existsSync(join(temp.path, 'db/projo.db'))).toBe(true)

    await started.value.stop()
  })

  test('recovers from a crash: last-attempt job failed and notified, open scan runs closed', async () => {
    temp = createTempDir()
    const start = () => {
      const started = startProjo({
        env: { PORT: '0', DATA_DIR: temp.path, LOG_LEVEL: 'error' },
        appPaths: resolveAppPaths(import.meta.dir),
      })
      if (!started.ok) throw new Error(started.error.message)
      return started.value
    }
    await (await start()).stop()

    // What a crash leaves behind: a job running on its last attempt, a scan run never finished.
    const db = new Database(join(temp.path, 'db/projo.db'))
    const at = '2026-01-01T00:00:00.000Z'
    db.run(
      `INSERT INTO jobs (id, type, payload, priority, state, attempts, max_attempts, run_after, started_at)
       VALUES ('job-1', 'cleanup_cache', '{}', 50, 'running', 3, 3, ?, ?)`,
      [at, at],
    )
    db.run(`INSERT INTO libraries (id, name, created_at) VALUES ('lib-1', 'Films', ?)`, [at])
    db.run(
      `INSERT INTO scan_runs (id, library_id, kind, started_at, stats) VALUES ('run-1', 'lib-1', 'manual_quick', ?, ?)`,
      [at, JSON.stringify({ seen: 0, discovered: 0, pending: 0, ready: 0, missing: 0, errors: 0 })],
    )
    db.close()

    const running = start()
    await running.stop()

    const after = new Database(join(temp.path, 'db/projo.db'))
    expect(after.query("SELECT state FROM jobs WHERE id = 'job-1'").get()).toEqual({
      state: 'failed',
    })
    const notification = after
      .query("SELECT kind, severity, context FROM notifications WHERE kind = 'job/failed'")
      .get() as { kind: string; severity: string; context: string } | undefined
    expect(notification).toMatchObject({ kind: 'job/failed', severity: 'error' })
    expect(JSON.parse(notification?.context ?? '{}')).toMatchObject({
      jobId: 'job-1',
      jobType: 'cleanup_cache',
      code: 'job/handler_crashed',
    })
    expect(
      after.query("SELECT finished_at, error FROM scan_runs WHERE id = 'run-1'").get(),
    ).toEqual({
      finished_at: expect.any(String),
      error: 'scan/interrupted',
    })
    after.close()
  })

  test('refuses an invalid configuration', () => {
    temp = createTempDir()
    const started = startProjo({ env: { PORT: 'x', DATA_DIR: temp.path } })
    expect(started.ok).toBe(false)
    if (!started.ok) expect(started.error.code).toBe('config/invalid')
  })
})
