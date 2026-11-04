import type { PlayableSource } from '../catalog/catalog.ts'
import type { ChapterInfo } from '../playback/media-info.ts'
import { groupVersions, rankVersions } from '../playback/versions.ts'
import type { SegmentCandidate, SegmentType } from './segment.ts'

const maxWords = 3

export const chapterType = (title: string | undefined): SegmentType | undefined => {
  if (title === undefined) return undefined
  const text = title.trim().toLowerCase()
  if (/^(op|ed)\s*\d*(\s*[-:–|].*)?$/u.test(text))
    return text.startsWith('op') ? 'intro' : 'credits'
  const list = text.split(/[^\p{L}\p{N}]+/u).filter((word) => word !== '')
  if (list.length > maxWords) return undefined
  const words = new Set(list)
  const has = (...candidates: string[]) => candidates.some((word) => words.has(word))
  if (has('intro', 'introduction', 'opening')) return 'intro'
  if (has('recap', 'previously')) return 'recap'
  if (has('preview')) return 'preview'
  if (has('credits', 'credit', 'ending', 'outro', 'endcredits')) {
    return has('mid', 'post', 'pre', 'scene') ? undefined : 'credits'
  }
  return undefined
}

const contiguousMs = 1_000

export const chapterSegments = (
  chapters: readonly ChapterInfo[],
  durationMs?: number,
): SegmentCandidate[] => {
  const runs: { type: SegmentType; startMs: number; endMs: number }[] = []
  for (const chapter of [...chapters].sort((a, b) => a.startMs - b.startMs)) {
    const type = chapterType(chapter.title)
    if (type === undefined) continue
    const last = runs[runs.length - 1]
    if (last !== undefined && last.type === type && chapter.startMs - last.endMs <= contiguousMs) {
      last.endMs = Math.max(last.endMs, chapter.endMs)
    } else {
      runs.push({ type, startMs: chapter.startMs, endMs: chapter.endMs })
    }
  }
  const pick = (type: SegmentType, last: boolean) => {
    const ofType = runs.filter((run) => run.type === type)
    return last ? ofType[ofType.length - 1] : ofType[0]
  }
  const chosen = [
    pick('intro', false),
    pick('recap', false),
    pick('credits', true),
    pick('preview', true),
  ]
  return chosen.flatMap((run) => {
    if (run === undefined) return []
    const endMs = durationMs === undefined ? run.endMs : Math.min(run.endMs, durationMs)
    return endMs > run.startMs ? [{ type: run.type, startMs: run.startMs, endMs }] : []
  })
}

export type ItemTimeline = {
  durationMs?: number
  chapters: ChapterInfo[]
}

export const itemTimeline = (sources: readonly PlayableSource[]): ItemTimeline => {
  const [best] = rankVersions(groupVersions(sources))
  if (best === undefined) return { chapters: [] }
  const chapters: ChapterInfo[] = []
  let offsetMs: number | undefined = 0
  for (const part of best.parts) {
    if (offsetMs === undefined) break
    for (const chapter of part.media?.chapters ?? []) {
      chapters.push({
        ...chapter,
        startMs: chapter.startMs + offsetMs,
        endMs: chapter.endMs + offsetMs,
      })
    }
    const partMs: number | undefined = part.media?.durationMs
    offsetMs = partMs === undefined ? undefined : offsetMs + partMs
  }
  return { ...(offsetMs === undefined ? {} : { durationMs: offsetMs }), chapters }
}

const SAME_CUT_TOLERANCE_MS = 5_000

export const segmentsForVersion = <S>(
  segments: S[],
  { referenceMs, playedMs }: { referenceMs: number | undefined; playedMs: number | undefined },
): S[] =>
  referenceMs === undefined ||
  playedMs === undefined ||
  Math.abs(referenceMs - playedMs) <= SAME_CUT_TOLERANCE_MS
    ? segments
    : []
