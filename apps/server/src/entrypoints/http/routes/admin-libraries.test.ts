import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { LibraryDto, LibraryListResponse, ScanRunsPage } from '@projo/shared/api/libraries'

import { createTempDir } from '../../../../test/support/database.ts'
import { createScannerWorld, type ScannerWorld } from '../../../../test/support/scanner-world.ts'

let world: ScannerWorld
let tmp: ReturnType<typeof createTempDir>

beforeEach(() => {
  world = createScannerWorld()
  tmp = createTempDir('projo-libs-')
  for (const dir of ['movies', 'series', 'movies/nested', 'other'])
    mkdirSync(join(tmp.path, dir), { recursive: true })
  writeFileSync(join(tmp.path, 'file.txt'), 'x')
})
afterEach(async () => {
  await world.stop()
  tmp.cleanup()
})

const post = (json: unknown) => world.request('/libraries', { method: 'POST', json })
const errorCode = async (response: Response) => {
  const body = (await response.json()) as { error?: { code: string } }
  return body.error?.code ?? 'none'
}

describe('admin libraries routes (§17.2)', () => {
  test('creates a library with defaults and queues its first scan', async () => {
    const response = await post({ name: 'Films', roots: [`${tmp.path}/movies/`] })
    expect(response.status).toBe(201)
    const library = (await response.json()) as LibraryDto
    expect(library).toMatchObject({
      name: 'Films',
      hint: 'auto',
      scanIntervalMinutes: 15,
      watchEnabled: true,
      quietPeriodSeconds: 120,
      detectSegments: true,
      preExtractSubtitles: false,
      trickplayEnabled: true,
      ratingCountry: 'FR',
      roots: [{ path: join(tmp.path, 'movies'), state: 'ok', lastFileCount: 0 }],
      sourceCounts: { pending: 0, ready: 0, missing: 0, rejected: 0 },
      analysis: { waiting: 0, verifying: 0, failed: 0 },
    })
    expect(world.query("SELECT type, payload FROM jobs WHERE type = 'scan_library'")).toEqual([
      {
        type: 'scan_library',
        payload: JSON.stringify({ libraryId: library.id, kind: 'initial' }),
      },
    ])
    const list = (await (await world.request('/libraries')).json()) as LibraryListResponse
    expect(list.items.map((item) => item.id)).toEqual([library.id])
  })

  test('refuses bad roots: missing, file, relative, overlapping, duplicated, symlinked twice', async () => {
    const cases: [unknown, number, string][] = [
      [[join(tmp.path, 'nope')], 422, 'library/root_not_found'],
      [[join(tmp.path, 'file.txt')], 422, 'library/root_not_directory'],
      [['relative/path'], 400, 'common/validation_failed'],
      [[`${tmp.path}/movies/../other`], 400, 'library/invalid_settings'],
      [[join(tmp.path, 'movies'), join(tmp.path, 'movies/nested')], 409, 'library/root_overlaps'],
      [[join(tmp.path, 'movies'), join(tmp.path, 'movies/')], 409, 'library/root_duplicate'],
      [[], 400, 'common/validation_failed'],
    ]
    for (const [roots, status, code] of cases) {
      const response = await post({ name: 'X', roots })
      expect({ roots, status: response.status, code: await errorCode(response) }).toEqual({
        roots,
        status,
        code,
      })
    }

    expect((await post({ name: 'Films', roots: [join(tmp.path, 'movies')] })).status).toBe(201)
    const taken = await post({ name: 'films', roots: [join(tmp.path, 'series')] })
    expect([taken.status, await errorCode(taken)]).toEqual([409, 'library/name_taken'])
    const overlap = await post({ name: 'Inner', roots: [join(tmp.path, 'movies/nested')] })
    expect([overlap.status, await errorCode(overlap)]).toEqual([409, 'library/root_overlaps'])
    symlinkSync(join(tmp.path, 'movies'), join(tmp.path, 'alias'))
    const alias = await post({ name: 'Alias', roots: [join(tmp.path, 'alias')] })
    expect([alias.status, await errorCode(alias)]).toEqual([409, 'library/root_duplicate'])
  })

  test('updates settings and replaces roots, deletes, 404s', async () => {
    const created = (await (
      await post({ name: 'Mixte', roots: [join(tmp.path, 'movies')] })
    ).json()) as LibraryDto
    const keptRootId = created.roots[0]?.id
    const response = await world.request(`/libraries/${created.id}`, {
      method: 'PATCH',
      json: {
        name: 'Tout',
        hint: 'series',
        quietPeriodSeconds: 30,
        metadataLanguage: 'en-US',
        ratingCountry: 'us',
        roots: [join(tmp.path, 'movies'), join(tmp.path, 'series')],
      },
    })
    expect(response.status).toBe(200)
    const updated = (await response.json()) as LibraryDto
    expect(updated).toMatchObject({
      name: 'Tout',
      hint: 'series',
      quietPeriodSeconds: 30,
      metadataLanguage: 'en-US',
      ratingCountry: 'US',
    })
    expect(updated.roots.map((root) => root.path)).toEqual([
      join(tmp.path, 'movies'),
      join(tmp.path, 'series'),
    ])
    expect(updated.roots[0]?.id).toBe(keptRootId)

    const cleared = (await (
      await world.request(`/libraries/${created.id}`, {
        method: 'PATCH',
        json: { metadataLanguage: '' },
      })
    ).json()) as LibraryDto
    expect(cleared.metadataLanguage).toBeUndefined()

    const invalid = await world.request(`/libraries/${created.id}`, {
      method: 'PATCH',
      json: { scanIntervalMinutes: 0 },
    })
    expect(invalid.status).toBe(400)

    expect((await world.request(`/libraries/${created.id}`, { method: 'DELETE' })).status).toBe(204)
    for (const [method, path] of [
      ['GET', `/libraries/${created.id}`],
      ['DELETE', `/libraries/${created.id}`],
      ['POST', `/libraries/${created.id}/scan`],
      ['GET', `/libraries/${created.id}/scans`],
    ] as const) {
      const missing = await world.request(path, {
        method,
        ...(method === 'POST' ? { json: {} } : {}),
      })
      expect([path, missing.status, await errorCode(missing)]).toEqual([
        path,
        404,
        'library/not_found',
      ])
    }
  })

  test('scan requests coalesce, a full scan replaces a queued quick one, runs are listed', async () => {
    const created = (await (
      await post({ name: 'Films', roots: [join(tmp.path, 'movies')] })
    ).json()) as LibraryDto
    await world.runJobs(['scan_library'])

    const scan = async (json: unknown) => {
      const response = await world.request(`/libraries/${created.id}/scan`, {
        method: 'POST',
        json,
      })
      expect(response.status).toBe(202)
      return (await response.json()) as { jobId: string; deduplicated: boolean }
    }
    const quick = await scan({})
    expect(await scan({ mode: 'quick' })).toEqual({ jobId: quick.jobId, deduplicated: true })
    const full = await scan({ mode: 'full' })
    expect(full).toMatchObject({ deduplicated: false })
    expect(full.jobId).not.toBe(quick.jobId)
    expect(world.query('SELECT state FROM jobs WHERE id = ?', quick.jobId)).toEqual([
      { state: 'cancelled' },
    ])
    expect(await scan({ mode: 'quick' })).toEqual({ jobId: full.jobId, deduplicated: true })

    await world.runJobs(['scan_library'])
    const page = (await (
      await world.request(`/libraries/${created.id}/scans?limit=1`)
    ).json()) as ScanRunsPage
    expect(page.items).toHaveLength(1)
    expect(page.items[0]).toMatchObject({ kind: 'manual_full', stats: { seen: 0, errors: 0 } })
    expect(page.nextCursor).toBeDefined()
    const next = (await (
      await world.request(`/libraries/${created.id}/scans?limit=5&cursor=${page.nextCursor ?? ''}`)
    ).json()) as ScanRunsPage
    expect(next.items.map((run) => run.kind)).toEqual(['initial'])
    expect(next.nextCursor).toBeUndefined()
  })
})
