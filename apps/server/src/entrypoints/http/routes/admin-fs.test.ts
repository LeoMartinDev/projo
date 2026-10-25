import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { FsBrowseResponse } from '@projo/shared/api/fs'

import { createTempDir } from '../../../../test/support/database.ts'
import { createScannerWorld, type ScannerWorld } from '../../../../test/support/scanner-world.ts'

let world: ScannerWorld
let tmp: ReturnType<typeof createTempDir>
let outside: ReturnType<typeof createTempDir>
let base: string

beforeEach(() => {
  world = createScannerWorld()
  tmp = createTempDir('projo-browse-')
  outside = createTempDir('projo-outside-')
  base = join(tmp.path, 'media')
  for (const dir of ['Films', 'films 10', 'films 2', '.hidden', 'Séries/Saison 1']) {
    mkdirSync(join(base, dir), { recursive: true })
  }
  writeFileSync(join(base, 'notes.txt'), 'not a directory')
  mkdirSync(join(outside.path, 'secret'))
  symlinkSync(join(base, 'Films'), join(base, 'films-link'))
  symlinkSync(outside.path, join(base, 'escape'))
  symlinkSync(join(base, 'notes.txt'), join(base, 'file-link'))
  symlinkSync(join(base, 'nowhere'), join(base, 'dangling'))
})
afterEach(async () => {
  await world.stop()
  tmp.cleanup()
  outside.cleanup()
})

const browse = (path: string) => world.request(`/fs/browse?path=${encodeURIComponent(path)}`)

describe('GET /admin/fs/browse (§20)', () => {
  test('lists directories only, sorted, links kept only inside the browsed folder', async () => {
    const response = await browse(base)
    expect(response.status).toBe(200)
    const body = (await response.json()) as FsBrowseResponse
    expect(body.path).toBe(base)
    expect(body.parent).toBe(tmp.path)
    expect(body.truncated).toBe(false)
    expect(body.entries).toEqual([
      { name: '.hidden', path: join(base, '.hidden'), hidden: true, symlink: false },
      { name: 'Films', path: join(base, 'Films'), hidden: false, symlink: false },
      { name: 'films 2', path: join(base, 'films 2'), hidden: false, symlink: false },
      { name: 'films 10', path: join(base, 'films 10'), hidden: false, symlink: false },
      { name: 'films-link', path: join(base, 'films-link'), hidden: false, symlink: true },
      { name: 'Séries', path: join(base, 'Séries'), hidden: false, symlink: false },
    ])
  })

  test('starts at / and normalizes the path', async () => {
    const root = (await (await world.request('/fs/browse')).json()) as FsBrowseResponse
    expect(root.path).toBe('/')
    expect(root.parent).toBeUndefined()
    const normalized = (await (await browse(`${base}//Séries/./`)).json()) as FsBrowseResponse
    expect(normalized.path).toBe(join(base, 'Séries'))
    expect(normalized.entries.map((e) => e.name)).toEqual(['Saison 1'])
  })

  test('refuses escapes, relative paths, files and missing paths', async () => {
    const cases: [string, number, string][] = [
      [`${base}/../../etc`, 400, 'fs/invalid_path'],
      ['..', 400, 'fs/invalid_path'],
      ['media/Films', 400, 'fs/invalid_path'],
      [`${base}/escape`, 400, 'fs/invalid_path'],
      [`${base}/escape/secret`, 400, 'fs/invalid_path'],
      [`${base}/notes.txt`, 400, 'fs/not_a_directory'],
      [`${base}/nope`, 404, 'fs/path_not_found'],
      [`${base}/dangling`, 404, 'fs/path_not_found'],
    ]
    for (const [path, status, code] of cases) {
      const response = await browse(path)
      const body = (await response.json()) as { error: { code: string } }
      expect({ path, status: response.status, code: body.error.code }).toEqual({
        path,
        status,
        code,
      })
    }
    // The link to a folder inside the browsed one is fine.
    const inside = (await (await browse(`${base}/films-link`)).json()) as FsBrowseResponse
    expect(inside.path).toBe(join(base, 'films-link'))
    expect(realpathSync(inside.path)).toBe(realpathSync(join(base, 'Films')))
  })
})
