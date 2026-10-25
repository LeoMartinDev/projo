import { afterAll, afterEach, describe, expect, test } from 'bun:test'
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { UpdatesStatusDto } from '@projo/shared/api/updates'

import { notifications } from '../../src/infrastructure/sqlite/schema/ops.ts'
import { buildTestRelease, startGithubReleasesServer } from '../support/github-releases-server.ts'
import { createUpdatesWorld } from '../support/updates-world.ts'

/**
 * §16.4 end to end on the app side: the fake GitHub serves real tiny bundles; the module checks,
 * downloads, verifies (§20), installs into `versions/<v>`, writes `pending` and asks to exit 75;
 * the restarted app settles the supervisor's report.
 */

const server = startGithubReleasesServer()
afterAll(() => server.stop())

let world: ReturnType<typeof createUpdatesWorld>
afterEach(() => {
  server.publish(undefined)
  world.cleanup()
})

const status = async (): Promise<UpdatesStatusDto> =>
  (await (await world.request('/updates')).json()) as UpdatesStatusDto

const openNotifications = () =>
  world.db
    .select()
    .from(notifications)
    .all()
    .filter((row) => !row.resolvedAt)
    .map((row) => ({ kind: row.kind, context: row.context }))

const listDir = (dir: string): string[] => (existsSync(dir) ? readdirSync(dir) : [])

describe('updates (§16.4)', () => {
  test('check, update, switch: from the available release to the version running after it', async () => {
    world = createUpdatesWorld({ server })
    const release = await buildTestRelease({ version: '1.4.0', runtimeMin: '0.2.0' })
    server.publish(release)

    expect((await world.request('/updates/check', { method: 'POST' })).status).toBe(202)
    await world.runJobs()
    const found = await status()
    expect(found).toMatchObject({
      enabled: true,
      current: { version: '1.3.0', runtime: '0.2.0' },
      state: 'available',
      available: { version: '1.4.0', runtimeMin: '0.2.0', runtimeCompatible: true },
    })
    expect(found.available?.notes).toBe('Notes of 1.4.0')
    expect(openNotifications()).toEqual([
      { kind: 'update/available', context: { version: '1.4.0', current: '1.3.0', key: '1.4.0' } },
    ])

    const applied = await world.request('/updates/apply', { json: { version: '1.4.0' } })
    expect(applied.status).toBe(202)
    // Singleton: a second click while it is queued.
    const again = await world.request('/updates/apply', { json: { version: '1.4.0' } })
    expect(again.status).toBe(409)
    const jobs = await world.runJobs()
    expect(jobs.map((job) => [job.type, job.state])).toEqual([['apply_update', 'done']])

    const installed = join(world.paths.app.versions, '1.4.0')
    for (const [path, content] of Object.entries(release.bundle))
      expect(readFileSync(join(installed, path), 'utf8')).toBe(content)
    expect(readFileSync(world.paths.app.pending, 'utf8').trim()).toBe('1.4.0')
    expect(listDir(world.paths.app.staging)).toEqual([])
    expect(world.exits()).toBe(1)
    const switching = await status()
    expect(switching.state).toBe('restarting')
    expect(switching.runs).toMatchObject([
      { kind: 'update', fromVersion: '1.3.0', toVersion: '1.4.0', outcome: 'pending' },
    ])
    expect(
      world.events.filter((event) => event.type === 'update.state').map((e) => e.payload),
    ).toContainEqual({
      state: 'restarting',
      version: '1.4.0',
    })

    // The supervisor switched and wrote its report; the app restarts on 1.4.0.
    writeFileSync(
      world.paths.app.switchResult,
      JSON.stringify({
        fromVersion: '1.3.0',
        toVersion: '1.4.0',
        outcome: 'switched',
        at: '2026-10-24T10:01:00.000Z',
      }),
    )
    await world.restart('1.4.0')
    expect(existsSync(world.paths.app.switchResult)).toBe(false)
    const after = await status()
    expect(after.state).toBe('idle')
    expect(after.available).toBeUndefined()
    expect(after.runs[0]).toMatchObject({
      outcome: 'succeeded',
      finishedAt: '2026-10-24T10:01:00.000Z',
    })
    expect(after.versions).toMatchObject([{ version: '1.4.0', state: 'current', canSwitch: false }])
    expect(openNotifications()).toEqual([])
  })

  test('an archive that does not match SHA256SUMS is not installed', async () => {
    world = createUpdatesWorld({ server })
    server.publish(await buildTestRelease({ version: '1.4.0', badArchiveChecksum: true }))
    await world.request('/updates/check', { method: 'POST' })
    await world.runJobs()
    await world.request('/updates/apply', { json: { version: '1.4.0' } })
    const [job] = await world.runJobs()
    expect(job).toMatchObject({ state: 'failed', error: { code: 'update/checksum_mismatch' } })
    expect(listDir(world.paths.app.versions)).toEqual([])
    expect(listDir(world.paths.app.staging)).toEqual([])
    expect(existsSync(world.paths.app.pending)).toBe(false)
    expect(world.exits()).toBe(0)
    const failed = await status()
    expect(failed.state).toBe('failed')
    expect(failed.runs).toMatchObject([
      { outcome: 'failed', error: { code: 'update/checksum_mismatch' } },
    ])
    expect(
      openNotifications()
        .map((row) => row.kind)
        .sort(),
    ).toEqual(['update/available', 'update/failed'])
  })

  test('a file that differs from the manifest is refused', async () => {
    world = createUpdatesWorld({ server })
    server.publish(await buildTestRelease({ version: '1.4.0', corruptFile: 'public/index.html' }))
    await world.request('/updates/check', { method: 'POST' })
    await world.runJobs()
    await world.request('/updates/apply', { json: { version: '1.4.0' } })
    const [job] = await world.runJobs()
    expect(job).toMatchObject({
      state: 'failed',
      error: { code: 'update/checksum_mismatch' },
    })
    expect(listDir(world.paths.app.versions)).toEqual([])
  })

  test('an archive entry leaving the bundle is refused before anything is written', async () => {
    world = createUpdatesWorld({ server })
    server.publish(
      await buildTestRelease({ version: '1.4.0', extraEntries: { '../../evil.txt': 'pwned' } }),
    )
    await world.request('/updates/check', { method: 'POST' })
    await world.runJobs()
    await world.request('/updates/apply', { json: { version: '1.4.0' } })
    const [job] = await world.runJobs()
    expect(job).toMatchObject({ state: 'failed', error: { code: 'update/invalid_release' } })
    expect(existsSync(join(world.paths.app.dir, 'evil.txt'))).toBe(false)
    expect(existsSync(join(world.paths.app.staging, 'evil.txt'))).toBe(false)
    expect(listDir(world.paths.app.versions)).toEqual([])
  })

  test('a release needing a newer runtime: notification with the docker pull, no update', async () => {
    world = createUpdatesWorld({ server, runtime: '0.2.0' })
    server.publish(await buildTestRelease({ version: '1.4.0', runtimeMin: '0.3.0' }))
    await world.request('/updates/check', { method: 'POST' })
    await world.runJobs()
    expect((await status()).available).toMatchObject({
      version: '1.4.0',
      runtimeCompatible: false,
      pullCommand: 'docker pull ghcr.io/leomartindev/projo:latest',
    })
    expect(openNotifications()).toEqual([
      {
        kind: 'update/runtime_too_old',
        context: {
          version: '1.4.0',
          runtimeMin: '0.3.0',
          runtimeVersion: '0.2.0',
          pullCommand: 'docker pull ghcr.io/leomartindev/projo:latest',
          key: '1.4.0',
        },
      },
    ])
    const refused = await world.request('/updates/apply', { json: { version: '1.4.0' } })
    expect(refused.status).toBe(409)
    expect(await refused.json()).toMatchObject({ error: { code: 'update/runtime_too_old' } })
  })

  test('a release without its manifest is invalid; GitHub down is recorded on the check', async () => {
    world = createUpdatesWorld({ server })
    server.publish(await buildTestRelease({ version: '1.4.0', omit: ['manifest.json'] }))
    await world.request('/updates/check', { method: 'POST' })
    const [job] = await world.runJobs()
    expect(job?.state).toBe('done')
    expect(await status()).toMatchObject({
      state: 'failed',
      lastCheckError: { code: 'update/invalid_release' },
    })
    expect((await status()).available).toBeUndefined()
  })

  test('no release yet, or nothing newer: idle', async () => {
    world = createUpdatesWorld({ server, version: '1.4.0' })
    await world.request('/updates/check', { method: 'POST' })
    await world.runJobs()
    expect((await status()).state).toBe('idle')
    server.publish(await buildTestRelease({ version: '1.4.0' }))
    await world.request('/updates/check', { method: 'POST' })
    await world.runJobs()
    const same = await status()
    expect(same.state).toBe('idle')
    expect(same.lastCheckedAt).toBe('2026-10-24T10:00:00.000Z')
    expect((await world.request('/updates/apply', { json: { version: '1.4.0' } })).status).toBe(409)
  })

  test('the supervisor rolled back: run, failed version, notification', async () => {
    world = createUpdatesWorld({ server })
    server.publish(await buildTestRelease({ version: '1.4.0' }))
    await world.request('/updates/check', { method: 'POST' })
    await world.runJobs()
    await world.request('/updates/apply', { json: { version: '1.4.0' } })
    await world.runJobs()
    writeFileSync(
      world.paths.app.switchResult,
      JSON.stringify({
        fromVersion: '1.3.0',
        toVersion: '1.4.0',
        outcome: 'rolled_back',
        at: '2026-10-24T10:02:00.000Z',
        reason: 'health_timeout',
      }),
    )
    await world.restart('1.3.0')
    const after = await status()
    expect(after.runs[0]).toMatchObject({ outcome: 'rolled_back' })
    expect(after.versions).toMatchObject([{ version: '1.4.0', state: 'failed', canSwitch: false }])
    expect(after.state).toBe('available')
    expect(openNotifications()).toContainEqual({
      kind: 'update/rolled_back',
      context: expect.objectContaining({ from: '1.3.0', to: '1.4.0', reason: 'health_timeout' }),
    })
  })

  test('rollback to a version on the disk, refused for an unknown one', async () => {
    world = createUpdatesWorld({ server })
    server.publish(await buildTestRelease({ version: '1.4.0' }))
    await world.request('/updates/check', { method: 'POST' })
    await world.runJobs()
    await world.request('/updates/apply', { json: { version: '1.4.0' } })
    await world.runJobs()
    writeFileSync(
      world.paths.app.switchResult,
      JSON.stringify({
        fromVersion: '1.3.0',
        toVersion: '1.4.0',
        outcome: 'switched',
        at: '2026-10-24T10:01:00.000Z',
      }),
    )
    // 1.3.0 is on the disk too (the version that ran before).
    const previous = await buildTestRelease({ version: '1.3.0' })
    for (const [path, content] of Object.entries(previous.bundle)) {
      const target = join(world.paths.app.versions, '1.3.0', path)
      await Bun.write(target, content)
    }
    await world.restart('1.4.0')
    expect((await status()).versions).toMatchObject([
      { version: '1.4.0', state: 'current', canSwitch: false },
      { version: '1.3.0', state: 'previous', canSwitch: true },
    ])

    const unknown = await world.request('/updates/rollback', { json: { version: '1.2.0' } })
    expect(unknown.status).toBe(404)
    const current = await world.request('/updates/rollback', { json: { version: '1.4.0' } })
    expect(current.status).toBe(409)

    const before = world.exits()
    const back = await world.request('/updates/rollback', { json: { version: '1.3.0' } })
    expect(back.status).toBe(202)
    expect(await back.json()).toEqual({ version: '1.3.0' })
    expect(readFileSync(world.paths.app.pending, 'utf8').trim()).toBe('1.3.0')
    expect(world.exits()).toBe(before + 1)
    expect((await status()).runs[0]).toMatchObject({
      kind: 'rollback',
      fromVersion: '1.4.0',
      toVersion: '1.3.0',
      outcome: 'pending',
    })
    // A second request while the switch is pending.
    expect((await world.request('/updates/rollback', { json: { version: '1.3.0' } })).status).toBe(
      409,
    )
  })

  test('disabled in development: every action answers update/disabled', async () => {
    world = createUpdatesWorld({ server, enabled: false })
    const check = await world.request('/updates/check', { method: 'POST' })
    expect(check.status).toBe(409)
    expect(await check.json()).toMatchObject({ error: { code: 'update/disabled' } })
    expect((await world.request('/updates/apply', { json: { version: '9.9.9' } })).status).toBe(409)
    expect((await world.request('/updates/rollback', { json: { version: '1.0.0' } })).status).toBe(
      409,
    )
    expect(await status()).toMatchObject({ enabled: false, versions: [], runs: [] })
  })
})
