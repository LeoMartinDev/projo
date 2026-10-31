import type { Context } from 'hono'

import { appError } from '@projo/shared'

import { parseRange } from '../../core/playback/byte-range.ts'
import type { MediaFiles } from '../../infrastructure/playback/media-files.ts'
import type { AppEnv } from './context.ts'
import { respondError } from './errors.ts'

/**
 * A file served with `Range` (direct play §10.2, hero previews §13.3: Safari asks for byte ranges
 * of every `<video>`): 200 for the whole file, 206 for a range, 416 for one outside it. `headers`
 * are those of every answer (type, cache).
 */
export const respondWithFile = (
  c: Context<AppEnv>,
  {
    mediaFiles,
    path,
    headers,
  }: { mediaFiles: MediaFiles; path: string; headers: Record<string, string> },
): Response => {
  const stats = mediaFiles.stat(path)
  if (!stats.ok) return respondError(c, stats.error)
  const { size } = stats.value
  const range = parseRange(c.req.header('range'), size)
  const common = { 'Accept-Ranges': 'bytes', ...headers }
  if (range.kind === 'unsatisfiable') {
    c.header('Content-Range', `bytes */${size}`)
    return respondError(
      c,
      appError('playback/range_not_satisfiable', 'range outside the file', { context: { size } }),
    )
  }
  if (range.kind === 'full') {
    return new Response(mediaFiles.slice(path), {
      status: 200,
      headers: { ...common, 'Content-Length': String(size) },
    })
  }
  const { start, end } = range.range
  return new Response(mediaFiles.slice(path, range.range), {
    status: 206,
    headers: {
      ...common,
      'Content-Length': String(end - start + 1),
      'Content-Range': `bytes ${start}-${end}/${size}`,
    },
  })
}
