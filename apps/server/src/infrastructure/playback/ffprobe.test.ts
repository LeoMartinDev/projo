import { afterEach, describe, expect, test } from 'bun:test'
import { chmodSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { createTempDir } from '../../../test/support/database.ts'
import { createFfprobe, parseKeyframeCsv } from './ffprobe.ts'

let temp: ReturnType<typeof createTempDir> | undefined
afterEach(() => temp?.cleanup())

describe('playback ffprobe', () => {
  test('a live probe that hangs is killed at its timeout, like the scanner one', async () => {
    temp = createTempDir()
    const binary = join(temp.path, 'ffprobe')
    // `exec`: the killed process is the one holding the pipes, as the real ffprobe.
    writeFileSync(binary, '#!/bin/sh\nexec sleep 30\n')
    chmodSync(binary, 0o755)
    const started = Date.now()
    const result = await createFfprobe({ binary, probeTimeoutMs: 200 }).probe('/media/film.mkv')
    expect(result).toMatchObject({ ok: false, error: { code: 'media/ffprobe_failed' } })
    expect(Date.now() - started).toBeLessThan(5_000)
  })

  test('keyframe times from the packet CSV, relative to the container start', () => {
    expect(parseKeyframeCsv('1.5,K__\n2.0,___\n3.5,K__\n', 1.5)).toEqual([0, 2])
  })
})
