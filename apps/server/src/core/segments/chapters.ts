import type { PlayableSource } from '../catalog/catalog.ts'
import type { ChapterInfo } from '../playback/media-info.ts'
import { groupVersions, rankVersions } from '../playback/versions.ts'
import type { SegmentCandidate, SegmentType } from './segment.ts'

const maxWords = 3

/**
 * §12.2 row 2: segments from the named chapters of the file. Matching is on words, case
 * insensitive, in titles of at most 3 words: `Intro`, `Opening`, `OP` → intro (so "Opening
 * Credits" is the intro); `Ending`, `ED`, `Credits`, `Outro` → credits; `Recap`, `Previously` →
 * recap; `Preview` → preview. `OP` / `ED` only as the whole title ("OP", "OP2", "ED - Song"): as a
 * word they are too ambiguous. Mid- and post-credits scenes are content, never credits; "Chapter
 * 1" and the like match nothing.
 */
export const chapterType = (title: string | undefined): SegmentType | undefined => {
  if (title === undefined) return undefined
  const text = title.trim().toLowerCase()
  if (/^(op|ed)\s*\d*(\s*[-:–|].*)?$/u.test(text))
    return text.startsWith('op') ? 'intro' : 'credits'
  const list = text.split(/[^\p{L}\p{N}]+/u).filter((word) => word !== '')
  // A descriptive movie chapter ("The Opening of the Gates", "A Happy Ending") is not a segment.
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

/** Chapters closer than this are one run (encoders leave small gaps between chapters). */
const contiguousMs = 1_000

/**
 * One candidate per type from chapters on the item timeline: consecutive chapters of the same
 * type are merged; intro and recap take the first run, credits and preview the last one (the end
 * credits, the next-episode preview). Empty runs are dropped; ends are clamped to `durationMs`.
 */
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
  /** The parts of the version added up; undefined when one of them has no known duration. */
  durationMs?: number
  /** Chapters of the parts, on the item timeline (§7.7: cumulative over the parts). */
  chapters: ChapterInfo[]
}

/**
 * The timeline segments live on: the best version of the ready sources (the one the player
 * opens by default), its parts in order. Chapters after a part of unknown duration are dropped
 * (their offset is unknown).
 */
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

/** Versions whose lengths differ by less than this are one cut (container and encode drift). */
const SAME_CUT_TOLERANCE_MS = 5_000

/**
 * §12, §7.7: segments are timed on `itemTimeline`'s version. Another version of another length
 * (another cut) gets none, rather than credits or an intro at the wrong time.
 */
export const segmentsForVersion = <S>(
  segments: S[],
  { referenceMs, playedMs }: { referenceMs: number | undefined; playedMs: number | undefined },
): S[] =>
  referenceMs === undefined ||
  playedMs === undefined ||
  Math.abs(referenceMs - playedMs) <= SAME_CUT_TOLERANCE_MS
    ? segments
    : []
