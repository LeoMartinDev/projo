import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'

import { dataPathsFor } from '../../src/core/data-paths.ts'
import type { JobContext, JobHandler } from '../../src/entrypoints/jobs/handler.ts'
import { buildFingerprintModule } from '../../src/entrypoints/modules/fingerprint.ts'
import type { Platform } from '../../src/entrypoints/modules/platform.ts'
import { createFpcalcFingerprinter } from '../../src/infrastructure/segments/fpcalc.ts'
import type { Db } from '../../src/infrastructure/sqlite/database.ts'
import { createSqliteSegmentRepository } from '../../src/infrastructure/sqlite/segment-repository.ts'
import { insertItem, insertLibrary, insertSource } from '../support/catalog-fixtures.ts'
import { createManualClock } from '../support/clock.ts'
import { createTempDir, createTestDatabase } from '../support/database.ts'
import { createRecordingJobQueue, createSequentialIds } from '../support/fakes.ts'
import { silentLogger } from '../support/logger.ts'
import { ffprobeJson, hasFfmpeg } from '../support/media.ts'

/**
 * §12.3 end to end with real ffmpeg and fpcalc: three tiny episodes (audio only, AAC) share a 20 s
 * "intro" tune at different, non hop-aligned offsets and an 18 s "credits" tune, with their own
 * tunes in between and pink noise of their own under everything.
 */

const canRun = hasFfmpeg() && (Bun.which('fpcalc') ?? '') !== ''

const tune = (seconds: number, seed: number) =>
  `aevalsrc=exprs='0.3*sin(2*PI*t*220*pow(2\\,floor(24*abs(sin(floor(t*4+${seed})*12.9898)))/12))+0.2*sin(2*PI*t*330*pow(2\\,floor(12*abs(sin(floor(t*3+${seed})*78.233)))/12))':s=16000:d=${seconds}`

const introSeconds = 20
const bodySeconds = 40
const creditsSeconds = 18
const episodes = [
  { id: 'e1', introAt: 1.3, seed: 1 },
  { id: 'e2', introAt: 6.11, seed: 2 },
  { id: 'e3', introAt: 12.77, seed: 3 },
].map((episode) => ({ ...episode, creditsAt: episode.introAt + introSeconds + bodySeconds }))

const generate = async (path: string, { introAt, seed }: (typeof episodes)[number]) => {
  const proc = Bun.spawn({
    cmd: [
      'ffmpeg',
      '-hide_banner',
      '-v',
      'error',
      '-y',
      ...['-f', 'lavfi', '-i', tune(introAt, seed * 1000)],
      ...['-f', 'lavfi', '-i', tune(introSeconds, 7)],
      ...['-f', 'lavfi', '-i', tune(bodySeconds, seed * 1000 + 500)],
      ...['-f', 'lavfi', '-i', tune(creditsSeconds, 3)],
      ...['-f', 'lavfi', '-i', tune(4, seed * 1000 + 900)],
      ...['-f', 'lavfi', '-i', `anoisesrc=d=200:c=pink:seed=${seed}:a=0.05:r=16000`],
      '-filter_complex',
      '[0][1][2][3][4]concat=n=5:v=0:a=1[m];[m][5]amix=inputs=2:duration=first:normalize=0[a]',
      ...['-map', '[a]', '-c:a', 'aac', '-b:a', '64k', path],
    ],
    stdout: 'ignore',
    stderr: 'pipe',
  })
  const [code, stderr] = await Promise.all([proc.exited, new Response(proc.stderr).text()])
  if (code !== 0) throw new Error(`ffmpeg failed to generate ${path}: ${stderr}`)
}

let media: ReturnType<typeof createTempDir>
let data: ReturnType<typeof createTempDir>
let db: Db
let handler: JobHandler | undefined
const durations = new Map<string, number>()

beforeAll(async () => {
  if (!canRun) return
  media = createTempDir('projo-fingerprint-media-')
  data = createTempDir('projo-fingerprint-data-')
  db = createTestDatabase()
  insertLibrary(db, { rootPath: media.path })
  insertItem(db, { id: 'series', kind: 'series' })
  insertItem(db, { id: 'season', kind: 'season', parentId: 'series', seasonNumber: 1 })
  await Promise.all(
    episodes.map((episode) => generate(join(media.path, `${episode.id}.mka`), episode)),
  )
  for (const [index, episode] of episodes.entries()) {
    const probe = await ffprobeJson(join(media.path, `${episode.id}.mka`))
    durations.set(episode.id, Number(probe.format.duration) * 1000)
    insertItem(db, {
      id: episode.id,
      kind: 'episode',
      parentId: 'season',
      seasonNumber: 1,
      episodeNumber: index + 1,
    })
    insertSource(db, {
      id: `f-${episode.id}`,
      itemId: episode.id,
      relativePath: `${episode.id}.mka`,
      extension: 'mka',
      probe,
    })
    // The episode's chain has run (`fetch_segments` always records its chapters first).
    createSqliteSegmentRepository({
      db,
      ids: createSequentialIds('seed-'),
      clock: createManualClock(),
    }).saveLookup({
      itemId: episode.id,
      provider: 'chapter',
      checkedAt: new Date(),
      outcome: 'none',
    })
  }
  const platform = {
    db,
    clock: createManualClock(new Date('2026-10-24T12:00:00.000Z')),
    ids: createSequentialIds('fp-'),
    logger: silentLogger,
    paths: dataPathsFor(data.path),
    jobQueue: createRecordingJobQueue().queue,
  } as unknown as Platform
  handler = buildFingerprintModule(platform, { cores: 8 }).jobHandlers.fingerprint_season
})

afterAll(() => {
  if (!canRun) return
  media.cleanup()
  data.cleanup()
})

describe.skipIf(!canRun)('fingerprint_season with ffmpeg and fpcalc (§12.3)', () => {
  test('finds the shared intro and credits of every episode within 1.5 s', async () => {
    const progress: number[] = []
    const started = performance.now()
    const result = await handler?.run({ seasonId: 'season' }, {
      signal: new AbortController().signal,
      reportProgress: (value: number) => progress.push(value),
      logger: silentLogger,
    } as unknown as JobContext)
    const elapsedMs = performance.now() - started
    expect(result).toEqual({ ok: true, value: undefined })
    expect(progress.at(-1)).toBe(100)

    const segments = createSqliteSegmentRepository({
      db,
      ids: createSequentialIds('check-'),
      clock: createManualClock(),
    })
    for (const { id, introAt, creditsAt } of episodes) {
      const intro = segments.find({ itemId: id, type: 'intro' })
      const credits = segments.find({ itemId: id, type: 'credits' })
      expect(intro).toMatchObject({ origin: 'fingerprint', confidence: 1 })
      expect(Math.abs((intro?.startMs ?? 0) / 1000 - introAt)).toBeLessThan(1.5)
      expect(Math.abs((intro?.endMs ?? 0) / 1000 - (introAt + introSeconds))).toBeLessThan(1.5)
      expect(Math.abs((credits?.startMs ?? 0) / 1000 - creditsAt)).toBeLessThan(1.5)
      expect(Math.abs((credits?.endMs ?? 0) / 1000 - (creditsAt + creditsSeconds))).toBeLessThan(
        1.5,
      )
      expect(segments.listLookups(id).find((row) => row.provider === 'fingerprint')).toMatchObject({
        outcome: 'found',
      })
    }
    // Temporary WAVs are gone.
    expect(readdirSync(join(data.path, 'cache', 'fingerprint'))).toEqual([])
    // Six windows (≈ 40 s of audio each): well under the test budget.
    expect(elapsedMs).toBeLessThan(8_000)
  })

  test('fpcalc missing: a clear error', async () => {
    const fingerprinter = createFpcalcFingerprinter({
      tempDir: join(data.path, 'cache', 'fingerprint'),
      fpcalcBinary: 'fpcalc-not-installed',
    })
    expect(
      await fingerprinter.fingerprint({
        path: join(media.path, 'e1.mka'),
        startSeconds: 0,
        durationSeconds: 30,
      }),
    ).toMatchObject({
      ok: false,
      error: {
        code: 'segment/fingerprint_failed',
        message: 'fpcalc-not-installed (Chromaprint) not found: install libchromaprint-tools',
        context: { reason: 'binary_missing' },
      },
    })
  })

  test('an unreadable file: fingerprint_failed', async () => {
    const fingerprinter = createFpcalcFingerprinter({
      tempDir: join(data.path, 'cache', 'fingerprint'),
    })
    expect(
      await fingerprinter.fingerprint({
        path: join(media.path, 'missing.mka'),
        startSeconds: 0,
        durationSeconds: 30,
      }),
    ).toMatchObject({ ok: false, error: { context: { reason: 'failed' } } })
  })
})
