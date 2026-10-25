import { afterEach, beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test'
import { mkdirSync, renameSync } from 'node:fs'
import { join } from 'node:path'

import type { LibraryDto, SourcesPage } from '@projo/shared/api/libraries'

import { createTempDir } from '../support/database.ts'
import { otherVideo, placeGarbage, placeVideo } from '../support/media-fixtures.ts'
import { createScannerWorld, type ScannerWorld } from '../support/scanner-world.ts'

setDefaultTimeout(60_000)

let world: ScannerWorld
let tmp: ReturnType<typeof createTempDir>
beforeEach(() => {
  world = createScannerWorld()
  tmp = createTempDir('projo-items-')
})
afterEach(async () => {
  await world.stop()
  tmp.cleanup()
})

const createLibrary = async (name: string, roots: string[], hint = 'auto') => {
  const response = await world.request('/libraries', {
    method: 'POST',
    json: { name, roots, hint },
  })
  expect(response.status).toBe(201)
  const library = (await response.json()) as LibraryDto
  await world.runJobs(['scan_library'])
  return library
}
const settle = async () => {
  world.clock.advance(121_000)
  world.jobQueue.enqueue({ type: 'watch_pending', payload: {}, dedupeKey: 'watch_pending' })
  await world.runJobs(['watch_pending'])
  await world.runJobs(['probe_source'])
}
const rescan = async (libraryId: string) => {
  await world.request(`/libraries/${libraryId}/scan`, { method: 'POST', json: {} })
  await world.runJobs(['scan_library'])
}
const titles = () =>
  world
    .query<{ kind: string; title: string; year?: number }>(
      // A season or an episode without a title of its own (§6.3) shows its number: '#2'.
      "SELECT kind, coalesce(nullif(title, ''), '#' || coalesce(episode_number, season_number)) AS title, year FROM items ORDER BY kind, 2, year",
    )
    .map((i) => `${i.kind}:${i.title}${i.year === undefined ? '' : ` (${i.year})`}`)

describe('M1 local items (§6.3, §7.7)', () => {
  test('versions of a film share one item; different years stay apart', async () => {
    placeVideo(tmp.path, 'Dune (2021) - 2160p.mkv')
    placeVideo(tmp.path, 'Copies/Dune.2021.1080p.mkv', otherVideo())
    placeVideo(tmp.path, 'Old/Dune (1984).mp4')
    await createLibrary('Films', [tmp.path], 'movies')
    await settle()
    expect(titles()).toEqual(['movie:Dune (1984)', 'movie:Dune (2021)'])
    const versions = world.query<{ n: number }>(
      'SELECT count(*) AS n FROM source_items si JOIN items i ON i.id = si.item_id WHERE i.year = 2021',
    )
    expect(versions).toEqual([{ n: 2 }])
  })

  test('a year-less file and a dated one of the same title share the item, which learns the year', async () => {
    placeVideo(tmp.path, 'Solaris.mkv')
    const library = await createLibrary('Films', [tmp.path])
    await settle()
    expect(titles()).toEqual(['movie:Solaris'])
    placeVideo(tmp.path, 'HD/Solaris (1972) 1080p.mkv', otherVideo())
    await rescan(library.id)
    await settle()
    expect(titles()).toEqual(['movie:Solaris (1972)'])
  })

  test('episodes from loose files and a series folder land in one series', async () => {
    placeVideo(tmp.path, 'The Bear/Season 1/The.Bear.S01E01.mkv')
    placeVideo(tmp.path, 'Vrac/The.Bear.S01E02.720p.mkv', otherVideo())
    placeVideo(tmp.path, 'Vrac/the bear s02e01.mp4')
    await createLibrary('Séries', [tmp.path])
    await settle()
    expect(titles()).toEqual([
      'episode:#1',
      'episode:#1',
      'episode:#2',
      'season:#1',
      'season:#2',
      'series:The Bear',
    ])
  })

  test('a rename that changes the parse relinks; the emptied local item is pruned', async () => {
    placeVideo(tmp.path, 'Inceptoin (2010).mkv')
    const library = await createLibrary('Films', [tmp.path])
    await settle()
    expect(titles()).toEqual(['movie:Inceptoin (2010)'])
    renameSync(join(tmp.path, 'Inceptoin (2010).mkv'), join(tmp.path, 'Inception (2010).mkv'))
    await rescan(library.id)
    expect(titles()).toEqual(['movie:Inception (2010)'])
  })

  test('items matched by TMDB (M2) are never touched by the local grouping', async () => {
    placeVideo(tmp.path, 'Heat (1995).mkv')
    const library = await createLibrary('Films', [tmp.path])
    await settle()
    world.db.$client.run("UPDATE items SET tmdb_id = 949, title = 'Heat'")
    mkdirSync(join(tmp.path, 'Moved'))
    renameSync(join(tmp.path, 'Heat (1995).mkv'), join(tmp.path, 'Moved/Something Else (2001).mkv'))
    await rescan(library.id)
    expect(world.query('SELECT tmdb_id, title FROM items')).toEqual([
      { tmdb_id: 949, title: 'Heat' },
    ])
    expect(world.query('SELECT count(*) AS n FROM source_items')).toEqual([{ n: 1 }])
  })

  test('deleting a library deletes its sources and the local items left without source', async () => {
    placeVideo(tmp.path, 'Heat (1995).mkv')
    const library = await createLibrary('Films', [tmp.path])
    await settle()
    expect(titles()).toEqual(['movie:Heat (1995)'])
    expect((await world.request(`/libraries/${library.id}`, { method: 'DELETE' })).status).toBe(204)
    expect(world.query('SELECT count(*) AS n FROM sources')).toEqual([{ n: 0 }])
    expect(titles()).toEqual([])
  })

  test('admin sources: list by state, re-check a failed probe', async () => {
    placeGarbage(tmp.path, 'Garbage (2002).mkv')
    const library = await createLibrary('Films', [tmp.path])
    await settle()
    const page = (await (
      await world.request(`/sources?libraryId=${library.id}&state=pending`)
    ).json()) as SourcesPage
    expect(page.items).toMatchObject([
      {
        relativePath: 'Garbage (2002).mkv',
        state: 'pending',
        pendingReason: 'probe_failed',
        displayTitle: 'Garbage',
        itemIds: [],
      },
    ])
    const id = page.items[0]?.id ?? ''
    // Fixed on disk (same size and mtime would not be re-checked by the scanner alone).
    const recheck = await world.request(`/sources/${id}/recheck`, { method: 'POST' })
    expect(recheck.status).toBe(202)
    await world.runJobs(['probe_source'])
    expect(world.query('SELECT state, pending_reason FROM sources')).toEqual([
      { state: 'pending', pending_reason: 'probe_failed' },
    ])
    const missing = await world.request('/sources/nope/recheck', { method: 'POST' })
    expect(missing.status).toBe(404)
  })
})

describe('playback sessions on sources about to be deleted (§10.6)', () => {
  const terminated = () =>
    world.events.flatMap((event) =>
      event.type === 'playback.session_terminated' ? [event.payload] : [],
    )
  const playFirstSource = (where = '1 = 1') => {
    const [source] = world.query<{ id: string }>(`SELECT id FROM sources WHERE ${where}`)
    if (source === undefined) throw new Error('no source')
    return world.startPlayback(source.id)
  }

  test('deleting a library ends its sessions (ffmpeg stopped, player told)', async () => {
    placeVideo(tmp.path, 'Heat (1995).mkv')
    const library = await createLibrary('Films', [tmp.path])
    await settle()
    const playing = playFirstSource()
    expect((await world.request(`/libraries/${library.id}`, { method: 'DELETE' })).status).toBe(204)
    expect(world.stoppedStreams).toEqual([playing.id])
    expect(terminated()).toEqual([
      { playbackSessionId: playing.id, sessionId: playing.authSessionId, reason: 'admin' },
    ])
  })

  test('removing a root ends the sessions on its sources only', async () => {
    placeVideo(tmp.path, 'A/Heat (1995).mkv')
    placeVideo(tmp.path, 'B/Ronin (1998).mkv', otherVideo())
    const rootA = join(tmp.path, 'A')
    const library = await createLibrary('Films', [rootA, join(tmp.path, 'B')])
    await settle()
    const kept = playFirstSource("relative_path LIKE 'Heat%'")
    const removed = playFirstSource("relative_path LIKE 'Ronin%'")
    const response = await world.request(`/libraries/${library.id}`, {
      method: 'PATCH',
      json: { roots: [rootA] },
    })
    expect(response.status).toBe(200)
    expect(world.stoppedStreams).toEqual([removed.id])
    expect(terminated().map((payload) => payload.playbackSessionId)).toEqual([removed.id])
    expect(world.query('SELECT id FROM playback_sessions')).toEqual([{ id: kept.id }])
  })

  test('a relink that prunes the played item ends the session', async () => {
    placeVideo(tmp.path, 'Inceptoin (2010).mkv')
    const library = await createLibrary('Films', [tmp.path])
    await settle()
    const playing = playFirstSource()
    renameSync(join(tmp.path, 'Inceptoin (2010).mkv'), join(tmp.path, 'Inception (2010).mkv'))
    await rescan(library.id)
    expect(titles()).toEqual(['movie:Inception (2010)'])
    expect(world.stoppedStreams).toEqual([playing.id])
    expect(terminated().map((payload) => payload.playbackSessionId)).toEqual([playing.id])
  })
})

describe('changing the hint (§7.1)', () => {
  test('re-classifies on the full scan it triggers', async () => {
    placeVideo(tmp.path, 'Planet Earth/01.mkv')
    const library = await createLibrary('Docs', [tmp.path])
    await settle()
    expect(world.query('SELECT classification FROM sources')).toEqual([{ classification: 'movie' }])
    const response = await world.request(`/libraries/${library.id}`, {
      method: 'PATCH',
      json: { hint: 'series' },
    })
    expect(response.status).toBe(200)
    await world.runJobs(['scan_library'])
    await world.runJobs(['probe_source'])
    expect(world.query('SELECT classification FROM sources')).toEqual([
      { classification: 'episode' },
    ])
    expect(titles()).toEqual(['episode:#1', 'season:#1', 'series:Planet Earth'])
  })
})
