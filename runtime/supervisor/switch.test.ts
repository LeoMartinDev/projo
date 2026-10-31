import { afterAll, describe, expect, test } from 'bun:test'
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { switchHandlerFactory, dbLayout, type SwitchReport } from './switch'
import { cleanupTempDirs, manualClock, memoryLogger, tempDir, writeBundle } from './test-support'
import {
  appLayout,
  pointLink,
  readAppState,
  readInstalledVersion,
  versionDir,
  type InstalledVersion,
} from './version-state'

afterAll(cleanupTempDirs)

const setup = async (versions: readonly string[] = ['1.2.0', '1.3.0', '1.4.0']) => {
  const dataDir = await tempDir()
  const layout = appLayout(dataDir)
  const db = dbLayout(dataDir)
  for (const version of versions) await writeBundle(versionDir(layout, version), { version })
  await pointLink(layout, 'current', '1.3.0')
  await mkdir(join(dataDir, 'db'), { recursive: true })
  await writeFile(db.file, 'database of 1.3.0')
  await writeFile(`${db.file}-wal`, 'wal of 1.3.0')
  const { clock } = manualClock()
  const { logger, codes } = memoryLogger()
  const handler = switchHandlerFactory({ layout, db, clock, logger })
  const running = await readInstalledVersion(layout, '1.3.0')
  if (!running.ok) throw new Error('fixture: 1.3.0 not installed')
  const report = async (): Promise<SwitchReport> =>
    JSON.parse(await readFile(join(layout.appDir, 'switch-result.json'), 'utf8')) as SwitchReport
  return { layout, db, handler, from: running.value as InstalledVersion, report, codes }
}

const currentVersion = async (layout: ReturnType<typeof appLayout>) => {
  const state = await readAppState(layout)
  return state.current.kind === 'ok' ? state.current.installed.version : state.current.kind
}

describe('version switch (§16.3)', () => {
  test('begin then confirm: backup, current, previous, two versions kept, report', async () => {
    const { layout, db, handler, from, report } = await setup()
    await writeFile(layout.pendingFile, '1.4.0\n')

    const pending = await handler.begin(from)
    expect(pending).toEqual({
      from: '1.3.0',
      to: '1.4.0',
      backup: join(db.backupsDir, 'projo-1.3.0.db'),
    })
    expect(await readFile(join(db.backupsDir, 'projo-1.3.0.db'), 'utf8')).toBe('database of 1.3.0')
    expect(await readFile(join(db.backupsDir, 'projo-1.3.0.db-wal'), 'utf8')).toBe('wal of 1.3.0')
    expect(await currentVersion(layout)).toBe('1.4.0')
    expect((await readAppState(layout)).pending).toBeUndefined()

    if (pending === undefined) throw new Error('unreachable')
    await handler.confirm(pending)
    const state = await readAppState(layout)
    expect(state.previous.kind === 'ok' && state.previous.installed.version).toBe('1.3.0')
    expect(state.installed).toEqual(['1.4.0', '1.3.0'])
    expect(await report()).toEqual({
      fromVersion: '1.3.0',
      toVersion: '1.4.0',
      outcome: 'switched',
      at: '1970-01-01T00:00:00.000Z',
    })
  })

  test('rollback: current back, database restored, report with the reason', async () => {
    const { layout, db, handler, from, report } = await setup()
    await writeFile(layout.pendingFile, '1.4.0')
    const pending = await handler.begin(from)
    if (pending === undefined) throw new Error('switch not started')
    // The new version migrated the database before failing.
    await writeFile(db.file, 'migrated by 1.4.0')
    await writeFile(`${db.file}-shm`, 'shm of 1.4.0')

    await handler.rollback(pending, 'health_timeout')
    expect(await currentVersion(layout)).toBe('1.3.0')
    expect(await readFile(db.file, 'utf8')).toBe('database of 1.3.0')
    expect(await readFile(`${db.file}-wal`, 'utf8')).toBe('wal of 1.3.0')
    expect(await readdir(join(layout.appDir, '..', 'db'))).not.toContain('projo.db-shm')
    expect(await report()).toMatchObject({
      fromVersion: '1.3.0',
      toVersion: '1.4.0',
      outcome: 'rolled_back',
      reason: 'health_timeout',
    })
    // The refused version stays on the disk (the app marks it failed).
    expect((await readAppState(layout)).installed).toContain('1.4.0')
  })

  test('confirm keeps the backup of the version left, not those of earlier switches', async () => {
    const { layout, db, handler, from } = await setup()
    await mkdir(db.backupsDir, { recursive: true })
    for (const name of [
      'projo-1.1.0.db',
      'projo-1.2.0.db',
      'projo-1.2.0.db-wal',
      'projo-2026-10-20T10-00-00-000Z-pre-migration.db',
      'projo-export-20261020-100000.db',
    ])
      await writeFile(join(db.backupsDir, name), 'old copy')
    await writeFile(layout.pendingFile, '1.4.0')
    const pending = await handler.begin(from)
    if (pending === undefined) throw new Error('switch not started')
    await handler.confirm(pending)
    expect((await readdir(db.backupsDir)).sort()).toEqual([
      'projo-1.3.0.db',
      'projo-1.3.0.db-wal',
      'projo-2026-10-20T10-00-00-000Z-pre-migration.db',
      'projo-export-20261020-100000.db',
    ])
  })

  test('a restore that stops halfway leaves the live database whole', async () => {
    const { layout, db, handler, from } = await setup()
    await writeFile(layout.pendingFile, '1.4.0')
    const pending = await handler.begin(from)
    if (pending?.backup === undefined) throw new Error('switch not started')
    await writeFile(db.file, 'migrated by 1.4.0')
    await writeFile(`${db.file}-wal`, 'wal of 1.4.0')
    // The backup's journal cannot be copied: the restore fails before touching the live files.
    await rm(`${pending.backup}-wal`)
    await mkdir(`${pending.backup}-wal`)

    await handler.rollback(pending, 'health_timeout')
    expect(await readFile(db.file, 'utf8')).toBe('migrated by 1.4.0')
    expect(await readFile(`${db.file}-wal`, 'utf8')).toBe('wal of 1.4.0')
  })

  test('a pending version that is not installed correctly is refused', async () => {
    const { layout, handler, from, report, codes } = await setup()
    await writeFile(layout.pendingFile, '1.4.0')
    await writeFile(join(versionDir(layout, '1.4.0'), 'server.js'), 'tampered')
    expect(await handler.begin(from)).toBeUndefined()
    expect(await currentVersion(layout)).toBe('1.3.0')
    expect(codes()).toContain('app/file_corrupted')
    expect(await report()).toMatchObject({ outcome: 'rolled_back', reason: 'invalid_version' })
    expect((await readAppState(layout)).pending).toBeUndefined()
  })

  test('no pending version: nothing to switch to, no report', async () => {
    const { layout, handler, from, codes } = await setup()
    expect(await handler.begin(from)).toBeUndefined()
    expect(codes()).toContain('update/pending_missing')
    expect(await readdir(layout.appDir)).not.toContain('switch-result.json')
  })
})
