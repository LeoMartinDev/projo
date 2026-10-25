import { afterAll, describe, expect, test } from 'bun:test'
import { mkdir, readdir, readlink, rm, writeFile } from 'node:fs/promises'
import { join, sep } from 'node:path'
import { prepareAppFactory } from './boot'
import { installSeedFactory } from './seed'
import { memoryLogger, cleanupTempDirs, tempDir, writeBundle } from './test-support'

afterAll(cleanupTempDirs)
import { appLayout, pointLink, versionDir } from './version-state'

const setup = async ({ seedVersion = '1.0.0', runtimeMin = '0.1.0' } = {}) => {
  const seedDir = join(await tempDir(), 'seed')
  await writeBundle(seedDir, {
    version: seedVersion,
    runtimeMin,
    files: { 'drizzle/0000_init.sql': 'create table t (id integer);' },
  })
  const layout = appLayout(await tempDir())
  const { logger, codes } = memoryLogger()
  const installSeed = installSeedFactory({ layout, seedDir, logger })
  const prepareApp = prepareAppFactory({ layout, runtimeVersion: '0.1.0', installSeed, logger })
  return { seedDir, layout, installSeed, prepareApp, codes }
}

describe('seed installation', () => {
  test('first start: copies the seed into versions/<v> and points current to it', async () => {
    const { layout, prepareApp } = await setup()
    const result = await prepareApp()
    expect(result.ok && result.value.version).toBe('1.0.0')
    expect(result.ok && result.value.dir).toBe(versionDir(layout, '1.0.0'))
    expect((await readlink(layout.currentLink)).replaceAll(sep, '/')).toBe('versions/1.0.0')
    expect(await readdir(versionDir(layout, '1.0.0'))).toEqual(
      expect.arrayContaining(['manifest.json', 'server.js', 'public', 'drizzle']),
    )
    expect(await readdir(layout.versionsDir)).toEqual(['1.0.0'])
  })

  test('an existing valid current wins over the seed', async () => {
    const { layout, prepareApp } = await setup({ seedVersion: '1.0.0' })
    await writeBundle(versionDir(layout, '1.4.0'), { version: '1.4.0' })
    await pointLink(layout, 'current', '1.4.0')
    const result = await prepareApp()
    expect(result.ok && result.value.version).toBe('1.4.0')
    expect(await readdir(layout.versionsDir)).toEqual(['1.4.0'])
  })

  test('a broken current is replaced by the seed and logged', async () => {
    const { layout, prepareApp, codes } = await setup()
    await mkdir(layout.appDir, { recursive: true })
    await writeBundle(versionDir(layout, '1.4.0'), { version: '1.4.0' })
    await pointLink(layout, 'current', '1.4.0')
    await rm(join(versionDir(layout, '1.4.0'), 'server.js'))
    const result = await prepareApp()
    expect(result.ok && result.value.version).toBe('1.0.0')
    expect(codes()).toContain('app/entry_missing')
  })

  test('reuses an intact versions/<v>, replaces a tampered one, and clears stale temp dirs', async () => {
    const { layout, installSeed } = await setup()
    expect((await installSeed()).ok).toBe(true)
    await rm(layout.currentLink)
    await mkdir(join(layout.versionsDir, '.tmp-1.0.0-1'))
    expect((await installSeed()).ok).toBe(true)
    expect(await readdir(layout.versionsDir)).toEqual(['1.0.0'])

    await writeFile(join(versionDir(layout, '1.0.0'), 'server.js'), 'tampered')
    expect((await installSeed()).ok).toBe(true)
    expect(await Bun.file(join(versionDir(layout, '1.0.0'), 'server.js')).text()).toBe(
      "console.log('projo 1.0.0')\n",
    )
  })

  test('no seed in the image: seed/missing', async () => {
    const { seedDir, prepareApp } = await setup()
    await rm(seedDir, { recursive: true })
    const result = await prepareApp()
    expect(result.ok ? undefined : result.error.code).toBe('seed/missing')
  })

  test('corrupted seed is refused', async () => {
    const { seedDir, prepareApp, layout } = await setup()
    await writeFile(join(seedDir, 'public/index.html'), 'changed')
    const result = await prepareApp()
    expect(result.ok ? undefined : result.error.code).toBe('app/file_corrupted')
    expect(await Bun.file(layout.currentLink).exists()).toBe(false)
  })

  test('warns when the app needs a newer runtime', async () => {
    const { prepareApp, codes } = await setup({ runtimeMin: '9.0.0' })
    expect((await prepareApp()).ok).toBe(true)
    expect(codes()).toContain('update/runtime_too_old')
  })
})
