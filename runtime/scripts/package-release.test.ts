import { afterAll, describe, expect, test } from 'bun:test'
import { mkdir, readFile, symlink } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { hashTree, MANIFEST_FILE } from '../supervisor/manifest'
import { cleanupTempDirs, tempDir } from '../supervisor/test-support'
import { archiveName, CHECKSUMS_FILE, packageRelease } from './package-release'

afterAll(cleanupTempDirs)

const sha256 = (data: Uint8Array | string): string => {
  const hasher = new Bun.CryptoHasher('sha256')
  hasher.update(data)
  return hasher.digest('hex')
}

const BUNDLE: Record<string, string> = {
  'server.js': "console.log('projo')\n",
  'server.js.map': '{}',
  'public/index.html': '<!doctype html>',
  'public/assets/app-1234.js': 'console.log(1)',
  'drizzle/0000_init.sql': 'create table t (id integer);',
  'drizzle/meta/_journal.json': '{"entries":[]}',
}

const writeFiles = async (root: string, files: Record<string, string>) => {
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true })
    await Bun.write(join(root, path), content)
  }
}

/** A bundle as build-bundle leaves it: files plus a manifest that lists them all. */
const fakeBundle = async (version = '1.2.3') => {
  const dir = await tempDir()
  await writeFiles(dir, BUNDLE)
  const manifest = {
    version,
    runtimeMin: '0.1.0',
    builtAt: '2026-10-24T12:00:00.000Z',
    files: await hashTree(dir),
  }
  await Bun.write(join(dir, MANIFEST_FILE), `${JSON.stringify(manifest, undefined, 2)}\n`)
  return dir
}

describe('package-release', () => {
  test('writes the archive, manifest.json and SHA256SUMS the updater expects', async () => {
    const bundleDir = await fakeBundle()
    const outDir = join(await tempDir(), 'release')
    const result = await packageRelease({ bundleDir, outDir, tag: 'v1.2.3' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(Object.keys(result.value.assets)).toEqual([
      'projo-app-1.2.3.tar.gz',
      MANIFEST_FILE,
      CHECKSUMS_FILE,
    ])

    // The bundle at the root of the archive, nothing else, contents unchanged.
    const archive = new Uint8Array(await readFile(join(outDir, archiveName('1.2.3'))))
    const entries = await new Bun.Archive(archive).files()
    expect([...entries.keys()].sort()).toEqual([...Object.keys(BUNDLE), MANIFEST_FILE].sort())
    for (const [path, content] of Object.entries(BUNDLE))
      expect(await entries.get(path)?.text()).toBe(content)

    // manifest.json published next to the archive is the very one inside it.
    const manifest = await readFile(join(outDir, MANIFEST_FILE), 'utf8')
    expect(manifest).toBe(await readFile(join(bundleDir, MANIFEST_FILE), 'utf8'))
    expect(await entries.get(MANIFEST_FILE)?.text()).toBe(manifest)

    expect(await readFile(join(outDir, CHECKSUMS_FILE), 'utf8')).toBe(
      `${sha256(archive)}  projo-app-1.2.3.tar.gz\n${sha256(manifest)}  manifest.json\n`,
    )
  })

  test('refuses a tag that is not v<bundle version>', async () => {
    const result = await packageRelease({
      bundleDir: await fakeBundle('1.2.3'),
      outDir: join(await tempDir(), 'release'),
      tag: 'v1.2.4',
    })
    expect(result.ok ? undefined : result.error).toMatchObject({
      code: 'release/version_mismatch',
      context: { tag: 'v1.2.4', version: '1.2.3' },
    })
  })

  test('refuses a bundle without a valid manifest', async () => {
    const bundleDir = await tempDir()
    await writeFiles(bundleDir, BUNDLE)
    const result = await packageRelease({ bundleDir, outDir: join(await tempDir(), 'release') })
    expect(result.ok ? undefined : result.error.code).toBe('release/bundle_invalid')
  })

  test('refuses a file changed after the manifest', async () => {
    const bundleDir = await fakeBundle()
    await Bun.write(join(bundleDir, 'public/index.html'), 'tampered')
    const outDir = join(await tempDir(), 'release')
    const result = await packageRelease({ bundleDir, outDir })
    expect(result.ok ? undefined : result.error).toMatchObject({
      code: 'release/bundle_invalid',
      context: { path: 'public/index.html', reason: 'hash_mismatch' },
    })
    expect(await Bun.file(join(outDir, CHECKSUMS_FILE)).exists()).toBe(false)
  })

  test('refuses a file the manifest does not list', async () => {
    const bundleDir = await fakeBundle()
    await writeFiles(bundleDir, { 'public/stray.txt': 'x' })
    const result = await packageRelease({ bundleDir, outDir: join(await tempDir(), 'release') })
    expect(result.ok ? undefined : result.error).toMatchObject({
      code: 'release/bundle_invalid',
      context: { extra: ['public/stray.txt'] },
    })
  })

  // Creating links needs privileges on Windows.
  test.skipIf(process.platform === 'win32')('refuses a symbolic link in the bundle', async () => {
    const bundleDir = await fakeBundle()
    await symlink('/etc/passwd', join(bundleDir, 'public/passwd'))
    const result = await packageRelease({ bundleDir, outDir: join(await tempDir(), 'release') })
    expect(result.ok ? undefined : result.error).toMatchObject({
      code: 'release/bundle_invalid',
      context: { entries: ['public/passwd'] },
    })
  })
})
