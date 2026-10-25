import { afterAll, describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { isSafeRelativePath, parseManifest, readManifest, verifyTree } from './manifest'
import { cleanupTempDirs, tempDir, writeBundle } from './test-support'

afterAll(cleanupTempDirs)

const valid = {
  version: '1.0.0',
  runtimeMin: '0.1.0',
  builtAt: '2026-10-23T00:00:00.000Z',
  files: { 'server.js': 'a'.repeat(64) },
}

describe('manifest', () => {
  test('accepts the §16.2 shape', () => {
    expect(parseManifest(valid).ok).toBe(true)
  })

  test.each([
    ['not an object', 'nope'],
    ['bad version', { ...valid, version: 'latest' }],
    ['bad runtimeMin', { ...valid, runtimeMin: 1 }],
    ['bad date', { ...valid, builtAt: 'yesterday' }],
    ['no entry', { ...valid, files: { 'public/index.html': 'a'.repeat(64) } }],
    ['bad hash', { ...valid, files: { 'server.js': 'xyz' } }],
    ['path escape', { ...valid, files: { ...valid.files, '../etc/passwd': 'a'.repeat(64) } }],
  ])('rejects %s', (_, raw) => {
    const result = parseManifest(raw)
    expect(result.ok ? undefined : result.error.code).toBe('app/manifest_invalid')
  })

  test('safe relative paths', () => {
    expect(isSafeRelativePath('public/assets/app.js')).toBe(true)
    for (const bad of ['/etc/passwd', 'a/../../b', './server.js', 'a\\b', ''])
      expect(isSafeRelativePath(bad)).toBe(false)
  })

  test('verifies files against their hashes', async () => {
    const dir = await tempDir()
    const manifest = await writeBundle(dir, {
      version: '1.0.0',
      files: { 'drizzle/0000_init.sql': 'create table t (id integer);' },
    })
    expect(Object.keys(manifest.files)).toEqual([
      'drizzle/0000_init.sql',
      'public/index.html',
      'server.js',
    ])
    expect((await readManifest(dir)).ok).toBe(true)
    expect((await verifyTree(dir, manifest)).ok).toBe(true)

    await Bun.write(join(dir, 'drizzle/0000_init.sql'), 'drop table t;')
    const tampered = await verifyTree(dir, manifest)
    expect(tampered.ok ? undefined : tampered.error.context).toMatchObject({
      path: 'drizzle/0000_init.sql',
      reason: 'hash_mismatch',
    })
  })
})
