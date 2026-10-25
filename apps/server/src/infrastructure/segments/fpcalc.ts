import { randomUUID } from 'node:crypto'
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'

import { z } from 'zod'

import { appError, err, ok } from '@projo/shared'

import type { AudioFingerprinter, FingerprintError } from '../../core/segments/fingerprint.ts'
import { toHostPath } from '../fs/host-paths.ts'
import {
  type ProcessError,
  type ProcessPriority,
  runProcess,
  stderrTail,
} from '../media/process.ts'

const fpcalcOutput = z.object({
  duration: z.number().optional(),
  fingerprint: z.array(z.number().int().min(0).max(0xffffffff)),
})

const failure = (
  reason: 'binary_missing' | 'timeout' | 'failed',
  message: string,
  context: Record<string, unknown>,
  cause?: unknown,
): FingerprintError =>
  appError('segment/fingerprint_failed', message, {
    context: { reason, ...context },
    ...(cause === undefined ? {} : { cause }),
  })

const fromProcessError = (binary: string, error: ProcessError): FingerprintError =>
  failure(
    error.code === 'media/binary_missing'
      ? 'binary_missing'
      : error.code === 'media/timeout'
        ? 'timeout'
        : 'failed',
    error.message,
    { binary, ...error.context },
    error,
  )

/**
 * `AudioFingerprinter` over ffmpeg + `fpcalc` (Chromaprint, `libchromaprint-tools` in the image):
 * the window is decoded to a temporary WAV (first audio track, mono, 16 kHz, §12.3) under
 * `tempDir`, then `fpcalc -raw -json -length <s>` reads it. The WAV is removed in every case.
 * A missing binary is reported with `reason: 'binary_missing'` and an install hint.
 */
export const createFpcalcFingerprinter = ({
  tempDir,
  ffmpegBinary = 'ffmpeg',
  fpcalcBinary = 'fpcalc',
  extractTimeoutMs = 5 * 60_000,
  fpcalcTimeoutMs = 2 * 60_000,
  processPriority = 'normal',
}: {
  tempDir: string
  ffmpegBinary?: string
  fpcalcBinary?: string
  extractTimeoutMs?: number
  fpcalcTimeoutMs?: number
  /** Of both ffmpeg and fpcalc. */
  processPriority?: ProcessPriority
}): AudioFingerprinter => ({
  fingerprint: async ({ path, startSeconds, durationSeconds, signal }) => {
    for (const binary of [ffmpegBinary, fpcalcBinary]) {
      if ((Bun.which(binary) ?? '') === '') {
        return err(
          failure(
            'binary_missing',
            binary === fpcalcBinary
              ? `${binary} (Chromaprint) not found: install libchromaprint-tools`
              : `${binary} not found`,
            { binary },
          ),
        )
      }
    }
    try {
      mkdirSync(tempDir, { recursive: true })
    } catch (cause) {
      return err(
        failure('failed', 'cannot create the fingerprint directory', { dirPath: tempDir }, cause),
      )
    }
    const wav = join(tempDir, `${randomUUID()}.wav`)
    const options = { priority: processPriority, ...(signal === undefined ? {} : { signal }) }
    try {
      const extract = await runProcess({
        command: ffmpegBinary,
        args: [
          '-hide_banner',
          '-nostdin',
          '-v',
          'error',
          '-y',
          '-ss',
          startSeconds.toFixed(3),
          // `file:` stops ffmpeg from reading a protocol or option in the name (§20).
          '-i',
          `file:${toHostPath(path)}`,
          '-t',
          durationSeconds.toFixed(3),
          '-map',
          '0:a:0',
          '-vn',
          '-sn',
          '-dn',
          '-ac',
          '1',
          '-ar',
          '16000',
          '-c:a',
          'pcm_s16le',
          '-f',
          'wav',
          `file:${wav}`,
        ],
        timeoutMs: extractTimeoutMs,
        ...options,
      })
      if (!extract.ok) return err(fromProcessError(ffmpegBinary, extract.error))
      if (extract.value.exitCode !== 0) {
        return err(
          failure('failed', 'audio extraction failed', {
            binary: ffmpegBinary,
            path,
            exitCode: extract.value.exitCode,
            stderr: stderrTail(extract.value.stderr),
          }),
        )
      }
      const run = await runProcess({
        command: fpcalcBinary,
        args: ['-raw', '-json', '-length', String(Math.ceil(durationSeconds)), wav],
        timeoutMs: fpcalcTimeoutMs,
        ...options,
      })
      if (!run.ok) return err(fromProcessError(fpcalcBinary, run.error))
      const { exitCode, stdout, stderr } = run.value
      if (exitCode !== 0) {
        return err(
          failure('failed', 'fpcalc failed', {
            binary: fpcalcBinary,
            path,
            exitCode,
            stderr: stderrTail(stderr),
          }),
        )
      }
      let json: unknown
      try {
        json = JSON.parse(stdout)
      } catch (cause) {
        return err(failure('failed', 'fpcalc output is not JSON', { path }, cause))
      }
      const parsed = fpcalcOutput.safeParse(json)
      if (!parsed.success) {
        return err(
          failure('failed', 'unexpected fpcalc output', { path, issues: parsed.error.issues }),
        )
      }
      return ok(parsed.data.fingerprint)
    } finally {
      rmSync(wav, { force: true })
    }
  },
})
