import { afterAll, afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

import { buildBundle } from '../../../../runtime/scripts/build-bundle.ts'
import { packageRelease } from '../../../../runtime/scripts/package-release.ts'
import { dataPathsFor } from '../../src/core/data-paths.ts'
import {
  RELEASE_CHECKSUMS_NAME,
  RELEASE_MANIFEST_NAME,
  releaseArchiveName,
} from '../../src/core/updates/update.ts'
import { ensureDataLayout } from '../../src/infrastructure/fs/data-layout.ts'
import { createGithubReleaseSource } from '../../src/infrastructure/updates/github-release-source.ts'
import { createFsReleaseInstaller } from '../../src/infrastructure/updates/release-installer.ts'
import { createTempDir } from '../support/database.ts'
import { startGithubReleasesServer, type TestRelease } from '../support/github-releases-server.ts'
import { silentLogger } from '../support/logger.ts'

/**
 * The release pipeline (§22) against the updater (§16.4): a bundle built by
 * `runtime/scripts/build-bundle.ts`, packed by `runtime/scripts/package-release.ts`, published on
 * the fake GitHub, then found and installed by the real release source and installer.
 * `PROJO_RELEASE_DIR` (the release job of CI) also runs it on the real release about to be
 * published (`dist/release`).
 */

const server = startGithubReleasesServer()
const temps: ReturnType<typeof createTempDir>[] = []
const tempDir = () => {
  const dir = createTempDir('projo-release-')
  temps.push(dir)
  return dir.path
}
afterAll(() => server.stop())
afterEach(() => {
  server.publish(undefined)
  for (const dir of temps.splice(0)) dir.cleanup()
})

const writeFiles = (root: string, files: Record<string, string>) => {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), content)
  }
}

/** The three release assets of `dir` as the fake GitHub serves them. */
const loadRelease = (dir: string): TestRelease => {
  const manifest = JSON.parse(readFileSync(join(dir, RELEASE_MANIFEST_NAME), 'utf8')) as {
    version: string
    runtimeMin: string
  }
  const names = [
    releaseArchiveName(manifest.version),
    RELEASE_MANIFEST_NAME,
    RELEASE_CHECKSUMS_NAME,
  ]
  expect(readdirSync(dir).sort()).toEqual([...names].sort())
  return {
    version: manifest.version,
    runtimeMin: manifest.runtimeMin,
    notes: `Notes of ${manifest.version}`,
    files: new Map(names.map((name) => [name, new Uint8Array(readFileSync(join(dir, name)))])),
    bundle: {},
  }
}

/** Finds the published release and installs it into a fresh data directory. */
const installPublished = async (release: TestRelease) => {
  server.publish(release)
  const source = createGithubReleaseSource({
    apiBaseUrl: server.apiBaseUrl,
    downloadPrefix: server.downloadPrefix,
    logger: silentLogger,
  })
  const latest = await source.latest({ channel: 'stable' })
  if (!latest.ok || latest.value === undefined) throw new Error('no release found')
  expect(latest.value).toMatchObject({
    version: release.version,
    runtimeMin: release.runtimeMin,
    archive: { name: releaseArchiveName(release.version) },
  })

  const paths = dataPathsFor(tempDir().replaceAll('\\', '/'))
  if (!ensureDataLayout(paths).ok) throw new Error('cannot create the data layout')
  const installer = createFsReleaseInstaller({
    paths: paths.app,
    downloadPrefix: server.downloadPrefix,
    logger: silentLogger,
  })
  const installed = await installer.install({
    release: latest.value,
    signal: new AbortController().signal,
    onProgress: () => undefined,
  })
  return { installed, installer, versionDir: join(paths.app.versions, release.version) }
}

describe('release pipeline → updater', () => {
  test('a packaged bundle is found, downloaded, verified and installed', async () => {
    const repo = tempDir()
    writeFiles(repo, {
      'apps/server/src/entrypoints/main.ts': "console.log('projo')\n",
      'apps/server/drizzle/0000_init.sql': 'create table t (id integer);',
      'apps/server/drizzle/meta/_journal.json': '{"entries":[]}',
      'apps/web/dist/index.html': '<!doctype html>',
      'apps/web/dist/assets/app.js': 'console.log(1)',
    })
    const bundleDir = join(repo, 'dist/app')
    const built = await buildBundle({
      rootDir: repo,
      outDir: bundleDir,
      version: '2.0.0',
      runtimeMin: '0.1.0',
    })
    expect(built.ok).toBe(true)
    const releaseDir = join(repo, 'dist/release')
    expect((await packageRelease({ bundleDir, outDir: releaseDir, tag: 'v2.0.0' })).ok).toBe(true)

    const { installed, installer, versionDir } = await installPublished(loadRelease(releaseDir))
    expect(installed.ok).toBe(true)
    if (!built.ok || !installed.ok) return
    expect(installed.value.files).toEqual(built.value.files)
    for (const path of [...Object.keys(built.value.files), RELEASE_MANIFEST_NAME])
      expect(readFileSync(join(versionDir, path))).toEqual(readFileSync(join(bundleDir, path)))
    expect((await installer.installed()).map(({ version }) => version)).toEqual(['2.0.0'])
  })

  const releaseDir = process.env.PROJO_RELEASE_DIR
  test.skipIf(releaseDir === undefined)('the release about to be published installs', async () => {
    const release = loadRelease(resolve(releaseDir ?? ''))
    const { installed, installer } = await installPublished(release)
    expect(installed.ok ? undefined : installed.error).toBeUndefined()
    expect((await installer.installed()).map(({ version }) => version)).toEqual([release.version])
  })
})
