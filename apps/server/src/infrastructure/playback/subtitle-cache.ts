import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import { extname, join } from 'node:path'

import { appError, err, ok, type Result } from '@projo/shared'

import {
  type FileFingerprint,
  sameFingerprint,
  type SubtitleCache,
  type SubtitleCacheError,
  type SubtitleInput,
} from '../../core/playback/media-assets.ts'
import { toHostPath } from '../fs/host-paths.ts'
import { type ProcessPriority, runProcess, stderrTail } from '../media/process.ts'
import {
  assetName,
  attemptFs,
  ensureDir,
  fileExists,
  fingerprintOf,
  fingerprintSchema,
  isAssetName,
  isTemporaryName,
  listEntries,
  readJsonFile,
  removePath,
  removeStaleTemporaries,
  writeFileAtomic,
} from './asset-files.ts'
import { decodeSubtitle, detectSubtitleCharset } from './subtitle-charset.ts'

const conversionTimeoutMs = 10 * 60_000

/** `file:` keeps ffmpeg from reading a path as a protocol or an option (§20). */
const fileArg = (path: string): string => `file:${toHostPath(path)}`

const webVttOutput = (path: string): string[] => ['-c:s', 'webvtt', '-f', 'webvtt', fileArg(path)]

/**
 * `/data/cache/subtitles/<source>/<track>.vtt` (§10.4), next to `<track>.json`: the size and
 * mtime of the input it was converted from (the external file, or the video file for an embedded
 * track). External text files are re-encoded to UTF-8 first when they are not (Latin-1…).
 * `ensure` (a player waits for it) runs ffmpeg at normal priority, `ensureEmbedded` (the
 * `extract_subtitles` pre-extraction job) at background priority (§18).
 */
export const createSubtitleCache = ({
  subtitlesDir,
  ffmpeg = 'ffmpeg',
}: {
  subtitlesDir: string
  ffmpeg?: string
}): SubtitleCache => {
  const sourceDir = (sourceId: string) => join(subtitlesDir, assetName(sourceId))
  const vttPath = (sourceId: string, trackId: string) =>
    join(sourceDir(sourceId), `${assetName(trackId)}.vtt`)
  const metaPath = (sourceId: string, trackId: string) =>
    join(sourceDir(sourceId), `${assetName(trackId)}.json`)

  const isFresh = (sourceId: string, trackId: string, fingerprint: FileFingerprint): boolean => {
    const stored = readJsonFile(metaPath(sourceId, trackId), fingerprintSchema)
    return (
      stored !== undefined &&
      sameFingerprint(stored, fingerprint) &&
      fileExists(vttPath(sourceId, trackId))
    )
  }

  /** Moves the converted file in place, then records what it was built from. */
  const commit = (
    sourceId: string,
    trackId: string,
    temporary: string,
    fingerprint: FileFingerprint,
  ): Result<void, SubtitleCacheError> =>
    attemptFs(
      () => {
        renameSync(temporary, vttPath(sourceId, trackId))
        writeFileAtomic(metaPath(sourceId, trackId), JSON.stringify(fingerprint))
      },
      { sourceId, trackId },
    )

  const runFfmpeg = async (
    args: string[],
    signal: AbortSignal | undefined,
    priority: ProcessPriority,
  ): Promise<Result<void, SubtitleCacheError>> => {
    const run = await runProcess({
      command: ffmpeg,
      args: ['-nostdin', '-hide_banner', '-v', 'error', '-y', ...args],
      timeoutMs: conversionTimeoutMs,
      priority,
      ...(signal === undefined ? {} : { signal }),
    })
    if (!run.ok) return run
    if (run.value.exitCode !== 0) {
      return err(
        appError('media/ffmpeg_failed', 'ffmpeg could not convert the subtitles', {
          context: { exitCode: run.value.exitCode, stderr: stderrTail(run.value.stderr) },
        }),
      )
    }
    return ok()
  }

  const temporaryName = (sourceId: string, trackId: string, suffix: string) =>
    join(sourceDir(sourceId), `${assetName(trackId)}.tmp-${process.pid}-${Date.now()}${suffix}`)

  /** An external file in UTF-8: itself, or a re-encoded copy (removed by the caller). */
  const utf8Input = (
    sourceId: string,
    trackId: string,
    path: string,
  ): Result<{ path: string; copy: boolean }, SubtitleCacheError> => {
    let bytes: Uint8Array
    try {
      bytes = readFileSync(toHostPath(path))
    } catch (cause) {
      return err(
        appError('playback/source_unavailable', 'subtitle file unreadable', {
          context: { path },
          cause,
        }),
      )
    }
    const charset = detectSubtitleCharset(bytes)
    // UTF-8 (with or without BOM) is read as is by ffmpeg.
    if (charset === 'utf-8') return ok({ path, copy: false })
    const copy = temporaryName(sourceId, trackId, `.input${extname(path).toLowerCase()}`)
    const written = attemptFs(() => writeFileSync(copy, decodeSubtitle(bytes, charset)), {
      sourceId,
      trackId,
    })
    return written.ok ? ok({ path: copy, copy: true }) : written
  }

  const convert = async (
    sourceId: string,
    trackId: string,
    input: SubtitleInput,
    fingerprint: FileFingerprint,
    signal: AbortSignal | undefined,
  ): Promise<Result<string, SubtitleCacheError>> => {
    const dir = attemptFs(() => ensureDir(sourceDir(sourceId)), { sourceId })
    if (!dir.ok) return dir
    const output = temporaryName(sourceId, trackId, '.vtt')
    const source =
      input.kind === 'external'
        ? utf8Input(sourceId, trackId, input.path)
        : ok({ path: input.path, copy: false })
    if (!source.ok) return source
    const converted = await runFfmpeg(
      [
        '-i',
        fileArg(source.value.path),
        '-map',
        input.kind === 'external' ? '0:s:0' : `0:${input.streamIndex}`,
        ...webVttOutput(output),
      ],
      signal,
      'normal',
    )
    if (source.value.copy) removePath(source.value.path)
    if (!converted.ok) {
      removePath(output)
      return converted
    }
    const committed = commit(sourceId, trackId, output, fingerprint)
    if (!committed.ok) removePath(output)
    return committed.ok ? ok(vttPath(sourceId, trackId)) : committed
  }

  const inFlight = new Map<string, Promise<Result<string, SubtitleCacheError>>>()
  const share = (
    key: string,
    work: () => Promise<Result<string, SubtitleCacheError>>,
  ): Promise<Result<string, SubtitleCacheError>> => {
    const running = inFlight.get(key)
    if (running !== undefined) return running
    const promise = work().finally(() => inFlight.delete(key))
    inFlight.set(key, promise)
    return promise
  }
  /** Tracks of a running `ensureEmbedded` pass: a request for one waits for the pass first. */
  const passes = new Map<string, Promise<Result<void, SubtitleCacheError>>>()

  return {
    ensure: ({ sourceId, trackId, input, signal }) =>
      share(`${sourceId}/${trackId}`, async () => {
        // A pass that fails or is cancelled (job aborted, one bad track of the file) does not
        // fail this track: converted on its own below.
        await passes.get(`${sourceId}/${trackId}`)
        const target = vttPath(sourceId, trackId)
        const fingerprint = fingerprintOf(input.path)
        if (!fingerprint.ok) return fingerprint
        if (isFresh(sourceId, trackId, fingerprint.value)) return ok(target)
        return convert(sourceId, trackId, input, fingerprint.value, signal)
      }),

    ensureEmbedded: async ({ sourceId, path, tracks, signal }) => {
      const fingerprint = fingerprintOf(path)
      if (!fingerprint.ok) return fingerprint
      const missing = tracks.filter(
        (track) =>
          !inFlight.has(`${sourceId}/${track.trackId}`) &&
          !passes.has(`${sourceId}/${track.trackId}`) &&
          !isFresh(sourceId, track.trackId, fingerprint.value),
      )
      if (missing.length === 0) return ok()
      const dir = attemptFs(() => ensureDir(sourceDir(sourceId)), { sourceId })
      if (!dir.ok) return dir
      const outputs = missing.map((track) => ({
        ...track,
        output: temporaryName(sourceId, track.trackId, '.vtt'),
      }))
      // One demux of the file for every track (§7.1 pre-extraction); `ensure` calls made
      // meanwhile wait for it, then convert their track alone if it failed.
      const pass = runFfmpeg(
        [
          '-i',
          fileArg(path),
          ...outputs.flatMap(({ streamIndex, output }) => [
            '-map',
            `0:${streamIndex}`,
            ...webVttOutput(output),
          ]),
        ],
        signal,
        'background',
      ).then((result): Result<void, SubtitleCacheError> => {
        if (result.ok) {
          for (const { trackId, output } of outputs) {
            const committed = commit(sourceId, trackId, output, fingerprint.value)
            if (!committed.ok) {
              for (const pending of outputs) removePath(pending.output)
              return committed
            }
          }
          return ok()
        }
        for (const { output } of outputs) removePath(output)
        return result
      })
      for (const { trackId } of outputs) {
        const key = `${sourceId}/${trackId}`
        const tracked = pass.finally(() => {
          if (passes.get(key) === tracked) passes.delete(key)
        })
        passes.set(key, tracked)
      }
      return pass
    },

    listSourceIds: () =>
      listEntries(subtitlesDir)
        .filter((entry) => entry.isDirectory && isAssetName(entry.name))
        .map((entry) => entry.name),

    listTrackIds: (sourceId) =>
      listEntries(sourceDir(sourceId))
        .filter(
          (entry) =>
            !entry.isDirectory && entry.name.endsWith('.vtt') && !isTemporaryName(entry.name),
        )
        .map((entry) => entry.name.slice(0, -'.vtt'.length))
        .filter(isAssetName),

    removeStaleTemporaries: (olderThan) =>
      listEntries(subtitlesDir)
        .filter((entry) => entry.isDirectory)
        .reduce(
          (removed, entry) =>
            removed + removeStaleTemporaries(join(subtitlesDir, entry.name), olderThan),
          0,
        ),

    remove: ({ sourceId, trackId }) => {
      if (trackId === undefined) {
        removePath(sourceDir(sourceId))
        return
      }
      removePath(vttPath(sourceId, trackId))
      removePath(metaPath(sourceId, trackId))
    },
  }
}
