import { afterEach, beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test'
import { mkdirSync, renameSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { LibraryDto, SourcesPage } from '@projo/shared/api/libraries'

import { insertLibrary } from '../support/catalog-fixtures.ts'
import { createTempDir } from '../support/database.ts'
import { silentLogger } from '../support/logger.ts'
import {
  completeVideo,
  otherVideo,
  placeCorruptedVideo,
  placeGarbage,
  placePartialVideo,
  placeText,
  placeVideo,
  videoWithEmbeddedSubtitles,
} from '../support/media-fixtures.ts'
import { createScannerWorld, type ScannerWorld } from '../support/scanner-world.ts'

// Real ffprobe and ffmpeg on generated 3 s videos (§22).
setDefaultTimeout(60_000)

type SourceRow = {
  id: string
  relative_path: string
  state: string
  pending_reason?: string
  classification: string
  stack_group_id?: string
  part_index?: number
  inode?: string
}

type ItemRow = {
  id: string
  kind: string
  title: string
  year?: number
  parent_id?: string
  season_number?: number
  episode_number?: number
  added_at?: string
}

const QUIET_MS = 120_000

let world: ScannerWorld
let tmp: ReturnType<typeof createTempDir>

beforeEach(() => {
  world = createScannerWorld()
  tmp = createTempDir('projo-scan-')
})
afterEach(async () => {
  await world.stop()
  tmp.cleanup()
})

const createLibrary = async (roots: string[], extra: Record<string, unknown> = {}) => {
  const response = await world.request('/libraries', {
    method: 'POST',
    json: { name: `Lib ${roots.length} ${Math.random()}`, roots, ...extra },
  })
  expect(response.status).toBe(201)
  return (await response.json()) as LibraryDto
}

const scan = async (libraryId: string, mode: 'quick' | 'full' = 'quick') => {
  const response = await world.request(`/libraries/${libraryId}/scan`, {
    method: 'POST',
    json: { mode },
  })
  expect(response.status).toBe(202)
  await world.runJobs(['scan_library'])
}

const watchPending = async () => {
  world.jobQueue.enqueue({ type: 'watch_pending', payload: {}, dedupeKey: 'watch_pending' })
  await world.runJobs(['watch_pending'])
}

/** Quiet period over, `watch_pending` then every probe. */
const settle = async () => {
  world.clock.advance(QUIET_MS + 1_000)
  await watchPending()
  await world.runJobs(['probe_source'])
}

const sources = () => world.query<SourceRow>('SELECT * FROM sources ORDER BY relative_path')
const sourceAt = (relativePath: string) => {
  const found = sources().find((s) => s.relative_path === relativePath)
  if (found === undefined) throw new Error(`no source at ${relativePath}`)
  return found
}
const items = () => world.query<ItemRow>('SELECT * FROM items ORDER BY kind, title')
/** §6.3 visibility: a movie or episode with a ready source. */
const visibleTitles = () =>
  world
    .query<{ title: string; kind: string }>(
      // An episode without a title of its own (§6.3) shows its number: '#2'.
      `SELECT DISTINCT coalesce(nullif(i.title, ''), '#' || i.episode_number) AS title, i.kind
       FROM items i
       JOIN source_items si ON si.item_id = i.id
       JOIN sources s ON s.id = si.source_id
       WHERE s.state = 'ready' ORDER BY i.kind, 1`,
    )
    .map((row) => `${row.kind}:${row.title}`)

describe('scanner on a messy folder (§7, §8)', () => {
  test('films and episodes in bulk end up ready with clean titles, nothing else', async () => {
    const root = tmp.path
    placeVideo(root, 'Inception (2010)/Inception.2010.1080p.BluRay.x264-GRP.mkv')
    placeText(root, 'Inception (2010)/Inception.2010.1080p.BluRay.x264-GRP.fr.srt')
    placeText(root, 'Inception (2010)/Inception.2010.1080p.BluRay.x264-GRP.en.forced.srt')
    placeVideo(root, 'Inception (2010)/Trailers/Inception trailer.mkv')
    placeVideo(root, 'Inception (2010)/inception-sample.mkv')
    placeVideo(root, 'The.Bear.S03E01.1080p.WEB.mkv')
    placeVideo(root, 'The.Bear.S03E02.1080p.WEB.mkv')
    placeVideo(root, 'Dexter/Season 4/Dexter.S04E01E02.Living.the.Dream.mkv')
    placeVideo(root, 'Film (2010)/Film (2010) - cd1.mkv')
    placeVideo(root, 'Film (2010)/Film (2010) - cd2.mkv')
    placeVideo(root, 'Le Fabuleux Destin (2001)/Le.Fabuleux.Destin.2001.FRENCH.1080p.mp4')
    placeText(root, 'Le Fabuleux Destin (2001)/Subs/English.srt')
    placeText(root, 'Le Fabuleux Destin (2001)/Subs/2_French.srt')
    placeVideo(root, 'Embedded (2019).mkv', videoWithEmbeddedSubtitles())
    placeVideo(root, 'Private/Home Video.mkv')
    writeFileSync(join(root, 'Private/.nomedia'), '')
    placeVideo(root, '.hidden.mkv')
    placeVideo(root, 'Downloading.mkv.!qB')
    placeVideo(root, 'Some Show - 12.mkv')
    placeCorruptedVideo(root, 'Broken (2001).mkv')
    placeGarbage(root, 'Garbage (2002).mkv')
    mkdirSync(join(root, 'Old DVD/VIDEO_TS'), { recursive: true })
    writeFileSync(join(root, 'Old DVD/VIDEO_TS/VTS_01_1.VOB'), 'x')

    const library = await createLibrary([root])
    await world.runJobs(['scan_library'])

    // Every candidate is in quarantine first: nothing visible (§7.3).
    const discovered = sources()
    expect(discovered.map((s) => s.relative_path)).toEqual([
      'Broken (2001).mkv',
      'Dexter/Season 4/Dexter.S04E01E02.Living.the.Dream.mkv',
      'Embedded (2019).mkv',
      'Film (2010)/Film (2010) - cd1.mkv',
      'Film (2010)/Film (2010) - cd2.mkv',
      'Garbage (2002).mkv',
      'Inception (2010)/Inception.2010.1080p.BluRay.x264-GRP.mkv',
      'Le Fabuleux Destin (2001)/Le.Fabuleux.Destin.2001.FRENCH.1080p.mp4',
      'Some Show - 12.mkv',
      'The.Bear.S03E01.1080p.WEB.mkv',
      'The.Bear.S03E02.1080p.WEB.mkv',
    ])
    expect(new Set(discovered.map((s) => `${s.state}/${s.pending_reason}`))).toEqual(
      new Set(['pending/growing']),
    )
    expect(visibleTitles()).toEqual([])

    // Quiet period not over: still nothing to probe.
    world.clock.advance(60_000)
    await watchPending()
    expect(await world.runJobs(['probe_source'])).toBe(0)

    await settle()

    expect(sourceAt('Broken (2001).mkv')).toMatchObject({
      state: 'pending',
      pending_reason: 'decode_failed',
    })
    expect(sourceAt('Garbage (2002).mkv')).toMatchObject({
      state: 'pending',
      pending_reason: 'probe_failed',
    })
    expect(sourceAt('Some Show - 12.mkv')).toMatchObject({
      state: 'ready',
      classification: 'unknown',
    })
    expect(sourceAt('The.Bear.S03E01.1080p.WEB.mkv')).toMatchObject({
      state: 'ready',
      classification: 'episode',
    })
    // §7.7 version, from the probe: codes, never a composed label.
    const ready = (await (
      await world.request(`/sources?libraryId=${library.id}&state=ready&limit=100`)
    ).json()) as SourcesPage
    expect(
      ready.items.find((s) => s.relativePath === 'The.Bear.S03E01.1080p.WEB.mkv')?.version,
    ).toEqual({ resolution: 'SD', dynamicRange: 'sdr', videoCodec: 'mpeg4' })

    expect(visibleTitles()).toEqual([
      'episode:#1',
      'episode:#2',
      'episode:Living the Dream',
      'movie:Embedded',
      'movie:Film',
      'movie:Inception',
      'movie:Le Fabuleux Destin',
    ])

    // Series tree: The Bear / Season 3 / E01-E02, Dexter / Season 4 / E01+E02 from one file.
    const all = items()
    const series = all.filter((i) => i.kind === 'series').map((i) => i.title)
    expect(series).toEqual(['Dexter', 'The Bear'])
    const dexter = all.find((i) => i.title === 'Dexter')
    const season4 = all.find((i) => i.kind === 'season' && i.parent_id === dexter?.id)
    // No title of its own (§6.3): '' in the NOT NULL column, the clients say "Saison 4".
    expect(season4).toMatchObject({ title: '', season_number: 4 })
    const dexterEpisodes = all.filter((i) => i.parent_id === season4?.id)
    expect(dexterEpisodes.map((e) => e.episode_number).sort()).toEqual([1, 2])
    const multi = sourceAt('Dexter/Season 4/Dexter.S04E01E02.Living.the.Dream.mkv')
    expect(world.query('SELECT * FROM source_items WHERE source_id = ?', multi.id)).toHaveLength(2)
    expect(all.every((i) => i.added_at !== undefined)).toBe(true)
    const matchStates = world.query<{ match_state: string }>(
      "SELECT DISTINCT match_state FROM sources WHERE state = 'ready' ORDER BY match_state",
    )
    // The unknown waits for "To review" (§7.8); everything else stays unmatched until TMDB (M2).
    expect(matchStates.map((row) => row.match_state)).toEqual(['needs_review', 'unmatched'])
    expect(
      world.query(
        'SELECT * FROM source_items WHERE source_id = ?',
        sourceAt('Some Show - 12.mkv').id,
      ),
    ).toEqual([])

    // Parts: one movie, two sources in one stack (§7.7).
    const cd1 = sourceAt('Film (2010)/Film (2010) - cd1.mkv')
    const cd2 = sourceAt('Film (2010)/Film (2010) - cd2.mkv')
    expect(cd1.stack_group_id).toBeDefined()
    expect(cd1.stack_group_id).toBe(cd2.stack_group_id)
    expect([cd1.part_index, cd2.part_index]).toEqual([1, 2])
    expect(all.filter((i) => i.kind === 'movie' && i.title === 'Film')).toHaveLength(1)

    // Subtitles: same-name files, the Subs/ folder, and the embedded track (§8.3).
    const subtitles = world.query<{
      path?: string
      kind: string
      language?: string
      forced: number
      sdh: number
      stream_index?: number
    }>(
      'SELECT path, kind, language, forced, sdh, stream_index FROM source_subtitles ORDER BY kind DESC, path',
    )
    const external = (path: string, language: string, forced = 0) => ({
      path: join(root, path),
      kind: 'external',
      language,
      forced,
      sdh: 0,
    })
    expect(subtitles).toEqual([
      external('Inception (2010)/Inception.2010.1080p.BluRay.x264-GRP.en.forced.srt', 'en', 1),
      external('Inception (2010)/Inception.2010.1080p.BluRay.x264-GRP.fr.srt', 'fr'),
      external('Le Fabuleux Destin (2001)/Subs/2_French.srt', 'fr'),
      external('Le Fabuleux Destin (2001)/Subs/English.srt', 'en'),
      { kind: 'embedded', language: 'en', forced: 0, sdh: 1, stream_index: 2 },
    ])

    // Events: progress, end of scan, one `source.ready` per ready source.
    const types = world.events.map((e) => e.type)
    expect(types).toContain('scan.progress')
    expect(types).toContain('scan.finished')
    expect(world.events.filter((e) => e.type === 'source.ready')).toHaveLength(9)
    const notifications = world.query<{ kind: string }>('SELECT kind FROM notifications')
    expect(notifications.map((n) => n.kind)).toEqual(['scan/unsupported_layout'])

    // Admin: counts by state, scan history.
    const detail = (await (await world.request(`/libraries/${library.id}`)).json()) as LibraryDto
    expect(detail.sourceCounts).toEqual({ pending: 2, ready: 9, missing: 0, rejected: 0 })
    // The two left pending are failures: the analysis is over.
    expect(detail.analysis).toEqual({ waiting: 0, verifying: 0, failed: 2 })
    expect(detail.roots[0]).toMatchObject({ state: 'ok', lastFileCount: 11 })
    expect(detail.lastScan).toMatchObject({
      kind: 'initial',
      stats: { discovered: 11, pending: 11 },
    })
    const pending = (await (
      await world.request(`/sources?libraryId=${library.id}&state=pending`)
    ).json()) as SourcesPage
    expect(pending.items.map((s) => s.pendingReason).sort()).toEqual([
      'decode_failed',
      'probe_failed',
    ])
  })

  test('a file being written never shows up before it is complete and quiet (§7.3)', async () => {
    const root = tmp.path
    const path = placePartialVideo(root, 'Downloads/Arrival.2016.1080p.mkv', 0.55)
    await createLibrary([root])
    await world.runJobs(['scan_library'])
    expect(sourceAt('Downloads/Arrival.2016.1080p.mkv')).toMatchObject({
      state: 'pending',
      pending_reason: 'growing',
    })

    // The download keeps going: every check restarts the quiet period.
    for (const fraction of [0.7, 0.85]) {
      world.clock.advance(100_000)
      placePartialVideo(root, 'Downloads/Arrival.2016.1080p.mkv', fraction)
      await watchPending()
      expect(await world.runJobs(['probe_source'])).toBe(0)
      expect(visibleTitles()).toEqual([])
    }
    // Pre-allocated (qBittorrent): same size, only the mtime moves.
    world.clock.advance(100_000)
    const { size } = statSync(path)
    utimesSync(path, new Date(), new Date(Date.now() + 5_000))
    await watchPending()
    expect(await world.runJobs(['probe_source'])).toBe(0)
    expect(statSync(path).size).toBe(size)

    completeVideo(path)
    world.clock.advance(30_000)
    await watchPending() // change seen: counter restarts
    world.clock.advance(60_000)
    await watchPending()
    expect(await world.runJobs(['probe_source'])).toBe(0)
    world.clock.advance(61_000)
    await watchPending()
    expect(await world.runJobs(['probe_source'])).toBe(1)
    expect(visibleTitles()).toEqual(['movie:Arrival'])
  })

  test('a quiet file is ready when its quiet period ends, without waiting for the 30 s tick', async () => {
    const root = join(tmp.path, 'now')
    mkdirSync(root)
    placeVideo(root, 'Instant (2020).mkv')
    await createLibrary([root], { quietPeriodSeconds: 0 })
    await world.runJobs(['scan_library'])
    // The scan itself asks for the check: no tick needed.
    await world.runJobs(['watch_pending'])
    expect(await world.runJobs(['probe_source'])).toBe(1)
    expect(sourceAt('Instant (2020).mkv').state).toBe('ready')

    const other = join(tmp.path, 'later')
    mkdirSync(other)
    placeVideo(other, 'Later (2021).mkv')
    await createLibrary([other], { quietPeriodSeconds: 45 })
    await world.runJobs(['scan_library'])
    await world.runJobs(['watch_pending'])
    world.clock.advance(44_000)
    expect(await world.runJobs(['watch_pending'])).toBe(0)
    world.clock.advance(1_000)
    expect(await world.runJobs(['watch_pending'])).toBe(1)
    expect(await world.runJobs(['probe_source'])).toBe(1)
  })

  test('scan.progress: indeterminate on a first walk, then a known total (§17.1)', async () => {
    const root = tmp.path
    placeVideo(root, 'Dune (2021)/Dune.2021.mkv')
    placeVideo(root, 'Arrival (2016)/Arrival.2016.mkv')
    const library = await createLibrary([root])
    await world.runJobs(['scan_library'])
    const progress = () =>
      world.events.flatMap((event) => (event.type === 'scan.progress' ? [event.payload] : []))
    const first = progress()
    expect(first[0]).toMatchObject({ phase: 'discovering', stats: { seen: 0 } })
    expect(first.filter((p) => p.phase === 'discovering').every((p) => p.total === undefined)).toBe(
      true,
    )
    expect(first.at(-1)).toMatchObject({ phase: 'processing', total: 2, stats: { seen: 2 } })

    placeVideo(root, 'Heat (1995)/Heat.1995.mkv')
    world.events.length = 0
    await scan(library.id)
    const second = progress()
    // Expected from the previous walk (2), then the files actually found (3).
    expect(second[0]).toMatchObject({ phase: 'discovering', total: 2 })
    expect(second.at(-1)).toMatchObject({ phase: 'processing', total: 3, stats: { seen: 3 } })
  })

  test('an interrupted scan is not done: a clean stop puts it back in the queue (§18)', async () => {
    // Inserted directly: the route only takes POSIX roots, this test also runs on Windows.
    const { libraryId } = insertLibrary(world.db, { id: 'lib-interrupted', rootPath: tmp.path })
    world.jobQueue.enqueue({ type: 'scan_library', payload: { libraryId, kind: 'manual_quick' } })
    const job = world.jobRepository.claimNext({ types: ['scan_library'], now: world.clock.now() })
    const handler = world.scanner.jobHandlers?.scan_library
    if (job === undefined || handler === undefined) throw new Error('no scan to run')
    const controller = new AbortController()
    controller.abort()
    const result = await handler.run(job.payload, {
      job,
      signal: controller.signal,
      reportProgress: () => {},
      logger: silentLogger,
    })
    expect(result).toMatchObject({ ok: false, error: { code: 'job/cancelled' } })
    expect(
      world.query<{ error?: string }>(
        'SELECT error FROM scan_runs WHERE library_id = ?',
        libraryId,
      ),
    ).toEqual([{ error: 'job/cancelled' }])
  })

  test('moves and renames keep the source and its item (§7.6)', async () => {
    const root = tmp.path
    placeVideo(root, 'Dune (2021)/Dune.2021.2160p.mkv')
    const library = await createLibrary([root])
    await world.runJobs(['scan_library'])
    await settle()
    const before = sourceAt('Dune (2021)/Dune.2021.2160p.mkv')
    const links = () =>
      world.query('SELECT item_id FROM source_items WHERE source_id = ?', before.id)
    const linksBefore = links()
    expect(linksBefore).toHaveLength(1)

    // Same inode: a rename (Radarr), across folders.
    mkdirSync(join(root, 'Films'))
    renameSync(join(root, 'Dune (2021)/Dune.2021.2160p.mkv'), join(root, 'Films/Dune (2021).mkv'))
    await scan(library.id)
    expect(sources()).toHaveLength(1)
    expect(sourceAt('Films/Dune (2021).mkv')).toMatchObject({ id: before.id, state: 'ready' })
    expect(links()).toEqual(linksBefore)

    // Different inode, same bytes (copy then delete): matched by signature.
    placeVideo(root, 'Archive/Dune.mkv')
    rmSync(join(root, 'Films/Dune (2021).mkv'))
    await scan(library.id)
    expect(sources()).toHaveLength(1)
    expect(sourceAt('Archive/Dune.mkv')).toMatchObject({ id: before.id, state: 'ready' })

    // A different file of another size is a new source; the old one goes missing.
    rmSync(join(root, 'Archive/Dune.mkv'))
    placeVideo(root, 'Archive/Dune Part Two (2024).mkv', otherVideo())
    await scan(library.id)
    expect(sourceAt('Archive/Dune.mkv')).toMatchObject({ id: before.id, state: 'missing' })
    expect(sourceAt('Archive/Dune Part Two (2024).mkv').state).toBe('pending')
    expect(links()).toEqual(linksBefore)
    expect(visibleTitles()).toEqual([])
  })

  test('missing files come back without loss; a replaced file goes back to quarantine (§7.3, §7.5)', async () => {
    const root = tmp.path
    const path = placeVideo(root, 'Heat (1995).mkv')
    const library = await createLibrary([root])
    await world.runJobs(['scan_library'])
    await settle()
    placeVideo(root, 'Keep (2000).mkv', otherVideo())
    const { mtime } = statSync(path)
    const id = sourceAt('Heat (1995).mkv').id

    renameSync(path, join(tmp.path, '..', `heat-${process.pid}.mkv`))
    await scan(library.id)
    expect(sourceAt('Heat (1995).mkv')).toMatchObject({ id, state: 'missing' })
    expect(visibleTitles()).toEqual([])

    renameSync(join(tmp.path, '..', `heat-${process.pid}.mkv`), path)
    expect(statSync(path).mtime).toEqual(mtime)
    await scan(library.id)
    expect(sourceAt('Heat (1995).mkv')).toMatchObject({ id, state: 'ready' })
    expect(visibleTitles()).toEqual(['movie:Heat'])

    // Upgrade in place: invisible until probed again, same item afterwards.
    const itemBefore = world.query('SELECT item_id FROM source_items WHERE source_id = ?', id)
    placeVideo(root, 'Heat (1995).mkv', otherVideo())
    await scan(library.id)
    expect(sourceAt('Heat (1995).mkv')).toMatchObject({
      state: 'pending',
      pending_reason: 'growing',
    })
    expect(visibleTitles()).toEqual([])
    await settle()
    expect(sourceAt('Heat (1995).mkv').state).toBe('ready')
    expect(world.query('SELECT item_id FROM source_items WHERE source_id = ?', id)).toEqual(
      itemBefore,
    )
  })

  test('an unreachable or emptied root never turns sources missing (§7.5)', async () => {
    const root = join(tmp.path, 'mount')
    placeVideo(root, 'Alien (1979).mkv')
    placeVideo(root, 'Aliens (1986).mkv')
    const library = await createLibrary([root])
    await world.runJobs(['scan_library'])
    await settle()
    const readyBefore = sources().map((s) => s.state)
    expect(readyBefore).toEqual(['ready', 'ready'])

    // Disk unmounted: the path is gone.
    renameSync(root, join(tmp.path, 'elsewhere'))
    await scan(library.id)
    expect(sources().map((s) => s.state)).toEqual(['ready', 'ready'])
    let detail = (await (await world.request(`/libraries/${library.id}`)).json()) as LibraryDto
    expect(detail.roots[0]).toMatchObject({ state: 'unreachable', lastError: 'not_found' })
    expect(detail.lastScan?.error).toBe('library/root_unreachable')
    const finished = world.events.filter((e) => e.type === 'scan.finished').at(-1)
    expect(finished?.payload).toMatchObject({ error: { code: 'library/root_unreachable' } })

    // Mount point present but empty.
    mkdirSync(root)
    await scan(library.id)
    expect(sources().map((s) => s.state)).toEqual(['ready', 'ready'])
    expect(world.query('SELECT last_error FROM library_roots')).toEqual([{ last_error: 'empty' }])
    expect(world.query('SELECT kind, resolved_at FROM notifications')).toEqual([
      { kind: 'library/root_unreachable' },
    ])

    // Back: the root is ok again, the notification resolved, a real deletion is a deletion.
    rmSync(root, { recursive: true })
    renameSync(join(tmp.path, 'elsewhere'), root)
    rmSync(join(root, 'Aliens (1986).mkv'))
    await scan(library.id)
    detail = (await (await world.request(`/libraries/${library.id}`)).json()) as LibraryDto
    expect(detail.roots[0]).toMatchObject({ state: 'ok', lastFileCount: 1 })
    expect(detail.roots[0]?.lastError).toBeUndefined()
    expect(sourceAt('Aliens (1986).mkv').state).toBe('missing')
    expect(sourceAt('Alien (1979).mkv').state).toBe('ready')
    expect(
      world.query<{ resolved_at?: string }>('SELECT resolved_at FROM notifications')[0]
        ?.resolved_at,
    ).toBeDefined()
  })

  test('a full scan re-checks ready sources and keeps unchanged ones (§7.4)', async () => {
    const root = tmp.path
    placeVideo(root, 'Solaris (1972).mkv')
    const library = await createLibrary([root])
    await world.runJobs(['scan_library'])
    await settle()
    const readyAt = world.query<{ ready_at: string }>('SELECT ready_at FROM sources')[0]?.ready_at
    await scan(library.id, 'full')
    expect(await world.runJobs(['probe_source'])).toBe(1)
    expect(world.query('SELECT state, ready_at FROM sources')).toEqual([
      { state: 'ready', ready_at: readyAt },
    ])
  })
})
