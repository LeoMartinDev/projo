import { afterAll, describe, expect, test } from 'bun:test'
import { mkdir, readlink, symlink, writeFile } from 'node:fs/promises'
import { join, sep } from 'node:path'
import { cleanupTempDirs, tempDir, writeBundle } from './test-support'

afterAll(cleanupTempDirs)
import { appLayout, pointLink, readAppState, versionDir } from './version-state'

const setupData = async () => {
  const layout = appLayout(await tempDir())
  await mkdir(layout.versionsDir, { recursive: true })
  return layout
}

describe('version state', () => {
  test('empty data dir: nothing installed', async () => {
    const layout = appLayout(await tempDir())
    expect(await readAppState(layout)).toEqual({
      current: { kind: 'missing' },
      previous: { kind: 'missing' },
      installed: [],
      pending: undefined,
    })
  })

  test('reads current, previous, installed versions and pending', async () => {
    const layout = await setupData()
    for (const version of ['1.3.2', '1.10.0', '1.4.0'])
      await writeBundle(versionDir(layout, version), { version })
    await mkdir(join(layout.versionsDir, '.tmp-1.5.0-42'))
    expect((await pointLink(layout, 'current', '1.4.0')).ok).toBe(true)
    expect((await pointLink(layout, 'previous', '1.3.2')).ok).toBe(true)
    await writeFile(layout.pendingFile, '1.10.0\n')

    const state = await readAppState(layout)
    expect(state.current.kind === 'ok' && state.current.installed).toMatchObject({
      version: '1.4.0',
      dir: versionDir(layout, '1.4.0'),
      entry: join(versionDir(layout, '1.4.0'), 'server.js'),
    })
    expect(state.previous.kind === 'ok' && state.previous.installed.version).toBe('1.3.2')
    expect(state.installed).toEqual(['1.10.0', '1.4.0', '1.3.2'])
    expect(state.pending).toBe('1.10.0')
    expect((await readlink(layout.currentLink)).replaceAll(sep, '/')).toBe('versions/1.4.0')
  })

  test('pointLink replaces an existing link atomically', async () => {
    const layout = await setupData()
    for (const version of ['1.0.0', '1.1.0'])
      await writeBundle(versionDir(layout, version), { version })
    await pointLink(layout, 'current', '1.0.0')
    await pointLink(layout, 'current', '1.1.0')
    const state = await readAppState(layout)
    expect(state.current.kind === 'ok' && state.current.installed.version).toBe('1.1.0')
  })

  test.each([
    [
      'dangling link',
      async (layout: ReturnType<typeof appLayout>) => symlink('versions/9.9.9', layout.currentLink),
      'app/manifest_invalid',
    ],
    [
      'link outside versions/',
      async (layout: ReturnType<typeof appLayout>) => symlink('/tmp', layout.currentLink),
      'app/link_invalid',
    ],
    [
      'plain directory',
      async (layout: ReturnType<typeof appLayout>) => mkdir(layout.currentLink),
      'app/link_invalid',
    ],
    [
      'manifest of another version',
      async (layout: ReturnType<typeof appLayout>) => {
        await writeBundle(versionDir(layout, '2.0.0'), { version: '1.0.0' })
        await symlink('versions/2.0.0', layout.currentLink)
      },
      'app/version_mismatch',
    ],
  ])('current is invalid: %s', async (_, arrange, code) => {
    const layout = await setupData()
    await arrange(layout)
    const { current } = await readAppState(layout)
    expect(current.kind === 'invalid' ? (current.error.code as string) : undefined).toBe(code)
  })
})
