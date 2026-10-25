import { afterAll, describe, expect, test } from 'bun:test'
import { mkdir, realpath } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { readManifest, verifyTree } from '../supervisor/manifest'
import { cleanupTempDirs, tempDir } from '../supervisor/test-support'
import { buildBundle } from './build-bundle'

afterAll(cleanupTempDirs)

const write = async (root: string, files: Record<string, string>) => {
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true })
    await Bun.write(join(root, path), content)
  }
}

const fakeRepo = async () => {
  const root = await tempDir()
  await write(root, {
    'apps/server/src/entrypoints/main.ts': [
      "import { join } from 'node:path'",
      "import { greet } from '../lib/greet'",
      "console.log(JSON.stringify({ greet: greet(), publicDir: join(import.meta.dir, 'public'), migrations: join(import.meta.dir, 'drizzle') }))",
    ].join('\n'),
    'apps/server/src/lib/greet.ts': "export const greet = () => 'hello'\n",
    'apps/server/drizzle/0000_init.sql': 'create table t (id integer);',
    'apps/server/drizzle/meta/_journal.json': '{"entries":[]}',
    'apps/web/dist/index.html': '<!doctype html>',
    'apps/web/dist/assets/app.js': 'console.log(1)',
    'apps/server/locales/fr.json': '{}',
  })
  return root
}

describe('build-bundle', () => {
  test('assembles server.js, public/, drizzle/ and a verifiable manifest', async () => {
    const root = await fakeRepo()
    const outDir = join(root, 'dist/app')
    const result = await buildBundle({
      rootDir: root,
      outDir,
      version: '1.2.3',
      runtimeMin: '0.1.0',
      now: () => new Date('2026-10-23T12:00:00Z'),
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.value).toMatchObject({
      version: '1.2.3',
      runtimeMin: '0.1.0',
      builtAt: '2026-10-23T12:00:00.000Z',
    })
    expect(Object.keys(result.value.files)).toEqual(
      expect.arrayContaining([
        'server.js',
        'public/index.html',
        'public/assets/app.js',
        'drizzle/0000_init.sql',
        'drizzle/meta/_journal.json',
        'locales/fr.json',
      ]),
    )
    const onDisk = await readManifest(outDir)
    expect(onDisk.ok && (await verifyTree(outDir, onDisk.value)).ok).toBe(true)

    // The app finds its assets relative to its own entry file.
    const run = Bun.spawnSync([process.execPath, join(outDir, 'server.js')])
    const realOut = await realpath(outDir)
    expect(JSON.parse(run.stdout.toString())).toEqual({
      greet: 'hello',
      publicDir: join(realOut, 'public'),
      migrations: join(realOut, 'drizzle'),
    })
  })

  test('fails cleanly while the sources do not exist', async () => {
    const root = await tempDir()
    const result = await buildBundle({
      rootDir: root,
      outDir: join(root, 'dist/app'),
      version: '1.0.0',
      runtimeMin: '0.1.0',
    })
    expect(result.ok ? undefined : result.error).toMatchObject({
      code: 'bundle/source_missing',
      context: {
        missing: ['apps/server/src/entrypoints/main.ts', 'apps/web/dist', 'apps/server/drizzle'],
      },
    })
  })

  test('rejects a non-semver version', async () => {
    const result = await buildBundle({
      rootDir: await fakeRepo(),
      outDir: '/nonexistent',
      version: 'dev',
      runtimeMin: '0.1.0',
    })
    expect(result.ok ? undefined : result.error.code).toBe('bundle/invalid_version')
  })

  test('reports a bundling error', async () => {
    const root = await fakeRepo()
    await write(root, {
      'apps/server/src/entrypoints/main.ts': "import { nope } from './missing'\nconsole.log(nope)",
    })
    const result = await buildBundle({
      rootDir: root,
      outDir: join(root, 'dist/app'),
      version: '1.0.0',
      runtimeMin: '0.1.0',
    })
    expect(result.ok ? undefined : result.error.code).toBe('bundle/build_failed')
    expect(await Bun.file(join(root, 'dist/app/manifest.json')).exists()).toBe(false)
  })
})
