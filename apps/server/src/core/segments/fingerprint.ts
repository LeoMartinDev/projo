import type { AppError, Result } from '@projo/shared'

import type { SegmentSettings } from '../settings/settings.ts'

/**
 * §12.3 local fingerprinting: comparison of Chromaprint fingerprints of the episodes of a season.
 *
 * **Input.** `fpcalc -raw` gives one 32-bit sub-fingerprint ("point") per Chromaprint frame
 * step. Chromaprint resamples to 11 025 Hz and slides a 4 096-sample frame by
 * `FRAME_SIZE - OVERLAP = 4096 - (4096 - 4096 / 3) = 1 365` samples: one point every
 * 1 365 / 11 025 s ≈ 0.1238 s (8.077 points/s). Point `i` is computed from the frames starting at
 * `i × 1 365` samples (a 5-tap chroma filter then a 16-row classifier window: a 60 s input gives
 * 463 points, checked with fpcalc 1.6.2), so `i × pointSeconds` is where its audio starts.
 *
 * **Pair comparison** (inspired by Intro Skipper's `ChromaprintAnalyzer`):
 * 1. Inverted index of the second fingerprint (point value → positions). Every point of the first
 *    with an exact twin votes for the shift `j − i`. Values repeated more than
 *    `maxRepeatsPerValue` times (silence, sustained tones) do not vote. The `maxShiftCandidates`
 *    most voted shifts with at least `minShiftVotes` votes are kept, each with its two
 *    neighbours (a start that is not a multiple of the 1 365-sample hop spreads the exact
 *    matches over two shifts).
 * 2. For each shift, both fingerprints are aligned and a point matches when the Hamming distance
 *    of the two 32-bit values is at most `⌊32 × (1 − similarity)⌋` bits (similarity 0.8 → 6 bits,
 *    Intro Skipper's `MaximumFingerprintPointDifferences`).
 * 3. Matching points form runs; a run survives gaps up to `maxGapSeconds` (3.5 s, Intro Skipper's
 *    `MaximumTimeSkip`), then its edges are trimmed to dense matches (half of the points of 1 s),
 *    so that a coincidence just after the passage does not stretch it. A run is kept when it
 *    lasts between `minSeconds` and `maxSeconds` (15 s – 150 s): a longer one is discarded, never
 *    truncated (the same file twice, a long recap). The longest kept run of all shifts is the
 *    pair's answer. Limit: a shift needs exact twins to be tried; Chromaprint gives plenty on the
 *    same audio, but a heavily re-encoded copy with no exact point would be missed.
 *
 * **Season** (§12.3 steps 3 and 5): every pair is compared; an episode gets a segment only when at
 * least one other episode corroborates it. Its partners' ranges are grouped around the range
 * most of them overlap (half of the shorter one), the segment is the median start and the
 * median end of that group, and its confidence is the share of the other episodes in the group.
 */

export const chromaprintSampleRate = 11_025
export const chromaprintHopSamples = 1_365
/** Duration covered by one raw point, in seconds (≈ 0.1238). */
export const pointSeconds = chromaprintHopSamples / chromaprintSampleRate

/** Audio read by one point: a 4 096-sample frame plus 19 hops (chroma filter + classifiers). */
export const pointSpanSeconds = (4_096 + 19 * chromaprintHopSamples) / chromaprintSampleRate

/**
 * A point already matches when most of its 2.7 s window is inside the shared audio: the first
 * matching point starts ≈ 0.6 s before the passage, and the passage ends ≈ 1.5 s after the start
 * of the last one. Measured with fpcalc 1.6.2 on generated fixtures (tones under pink noise, AAC,
 * shared passages at arbitrary sub-hop offsets): start −0.5…−0.8 s, end −0.1…−0.3 s before this
 * correction (±0.4 s after it, `test/integration/fingerprint.test.ts`). A run touching the edge
 * of the window is extended to that edge (credits running to the end of the file).
 */
export const runHeadSeconds = 0.6
export const runTailSeconds = 1.5

export type FingerprintParams = {
  minSeconds: number
  maxSeconds: number
  /** 0 to 1: share of identical bits for two points to match. */
  similarity: number
  maxGapSeconds?: number
}

export const defaultMaxGapSeconds = 3.5
const maxRepeatsPerValue = 16
const minShiftVotes = 2
const maxShiftCandidates = 24
/** ≈ 1 s: the edges of a run need half of these points matching. */
const edgeWindowPoints = 8

/** Seconds from the start of the fingerprinted window. */
export type TimeRange = { startSeconds: number; endSeconds: number }

export type SharedRun = { a: TimeRange; b: TimeRange; matchedPoints: number }

export const maxBitErrors = (similarity: number): number =>
  Math.max(0, Math.floor(32 * (1 - similarity) + 1e-9))

export const popcount32 = (value: number): number => {
  let v = value >>> 0
  v -= (v >>> 1) & 0x55555555
  v = (v & 0x33333333) + ((v >>> 2) & 0x33333333)
  return (Math.imul((v + (v >>> 4)) & 0x0f0f0f0f, 0x01010101) >>> 24) & 0xff
}

export type FingerprintIndex = Map<number, number[]>

export const indexFingerprint = (points: readonly number[]): FingerprintIndex => {
  const index: FingerprintIndex = new Map()
  points.forEach((value, position) => {
    const positions = index.get(value)
    if (positions === undefined) index.set(value, [position])
    else positions.push(position)
  })
  return index
}

/** Step 1: shifts `j − i` (b position minus a position) worth aligning, best voted first. */
export const candidateShifts = (a: readonly number[], bIndex: FingerprintIndex): number[] => {
  const votes = new Map<number, number>()
  a.forEach((value, i) => {
    const positions = bIndex.get(value)
    if (positions === undefined || positions.length > maxRepeatsPerValue) return
    for (const j of positions) votes.set(j - i, (votes.get(j - i) ?? 0) + 1)
  })
  const best = [...votes.entries()]
    .filter(([, count]) => count >= minShiftVotes)
    .sort(([shiftA, countA], [shiftB, countB]) => countB - countA || shiftA - shiftB)
    .slice(0, maxShiftCandidates)
    .map(([shift]) => shift)
  return [...new Set(best.flatMap((shift) => [shift, shift - 1, shift + 1]))]
}

type Run = { start: number; last: number; matched: number }

/** Matches in the `edgeWindowPoints` points ending (or starting) at `at`, both included. */
const hitsAround = (hits: Uint8Array, at: number, direction: 1 | -1): number => {
  let count = 0
  for (let k = 0; k < edgeWindowPoints; k++) count += hits[at + direction * k] ?? 0
  return count
}

/**
 * Step 3 edges: a run starts and ends on dense matches, so isolated coincidences bridged by the
 * gap tolerance (a note shared by chance right after the intro) do not stretch it.
 */
const trimRun = (hits: Uint8Array, run: Run): Run => {
  let { start, last } = run
  const minHits = edgeWindowPoints / 2
  while (start < last && (hits[start] === 0 || hitsAround(hits, start, 1) < minHits)) start++
  while (last > start && (hits[last] === 0 || hitsAround(hits, last, -1) < minHits)) last--
  let matched = 0
  for (let i = start; i <= last; i++) matched += hits[i] ?? 0
  return { start, last, matched }
}

/** Steps 2 and 3 for one shift: the longest run within the bounds, in `a` positions. */
const longestRunAt = (
  a: readonly number[],
  b: readonly number[],
  shift: number,
  { maxBits, maxGapPoints, minPoints, maxPoints }: Limits,
): Run | undefined => {
  const from = Math.max(0, -shift)
  const to = Math.min(a.length, b.length - shift)
  const hits = new Uint8Array(a.length)
  for (let i = from; i < to; i++) {
    if (popcount32((a[i] ?? 0) ^ (b[i + shift] ?? 0)) <= maxBits) hits[i] = 1
  }
  let best: Run | undefined
  let current: Run | undefined
  const close = () => {
    if (current === undefined) return
    const run = trimRun(hits, current)
    current = undefined
    const length = run.last - run.start + 1
    if (length < minPoints || length > maxPoints) return
    if (best === undefined || length > best.last - best.start + 1) best = run
  }
  for (let i = from; i < to; i++) {
    if (hits[i] === 0) continue
    if (current !== undefined && i - current.last > maxGapPoints) close()
    if (current === undefined) current = { start: i, last: i, matched: 1 }
    else {
      current.last = i
      current.matched++
    }
  }
  close()
  return best
}

type Limits = { maxBits: number; maxGapPoints: number; minPoints: number; maxPoints: number }

const limitsOf = ({ minSeconds, maxSeconds, similarity, maxGapSeconds }: FingerprintParams) => ({
  maxBits: maxBitErrors(similarity),
  maxGapPoints: Math.round((maxGapSeconds ?? defaultMaxGapSeconds) / pointSeconds),
  // A run of `n` points spans `n × pointSeconds + runTailSeconds - runHeadSeconds` of audio.
  minPoints: Math.ceil(Math.max(0, minSeconds - runTailSeconds + runHeadSeconds) / pointSeconds),
  maxPoints: Math.floor(Math.max(0, maxSeconds - runTailSeconds + runHeadSeconds) / pointSeconds),
})

const toRange = (start: number, last: number, length: number): TimeRange => ({
  startSeconds: start === 0 ? 0 : start * pointSeconds + runHeadSeconds,
  endSeconds:
    last >= length - 1
      ? (length - 1) * pointSeconds + pointSpanSeconds
      : last * pointSeconds + runTailSeconds,
})

/** The longest audio shared by two fingerprints, within the bounds, or `undefined`. */
export const findSharedRun = (
  a: readonly number[],
  b: readonly number[],
  params: FingerprintParams,
  bIndex: FingerprintIndex = indexFingerprint(b),
): SharedRun | undefined => {
  const limits = limitsOf(params)
  let best: { run: Run; shift: number } | undefined
  for (const shift of candidateShifts(a, bIndex)) {
    const run = longestRunAt(a, b, shift, limits)
    if (run === undefined) continue
    const length = run.last - run.start
    const bestLength = best === undefined ? -1 : best.run.last - best.run.start
    if (length > bestLength || (length === bestLength && run.matched > (best?.run.matched ?? 0)))
      best = { run, shift }
  }
  if (best === undefined) return undefined
  const { run, shift } = best
  return {
    a: toRange(run.start, run.last, a.length),
    b: toRange(run.start + shift, run.last + shift, b.length),
    matchedPoints: run.matched,
  }
}

export type EpisodeFingerprint = { key: string; points: readonly number[] }

export type DetectedSegment = TimeRange & {
  /** Share of the other episodes corroborating the range (§12.3 step 5). */
  confidence: number
  corroboratedBy: string[]
}

const overlapSeconds = (x: TimeRange, y: TimeRange): number =>
  Math.max(0, Math.min(x.endSeconds, y.endSeconds) - Math.max(x.startSeconds, y.startSeconds))

const agrees = (x: TimeRange, y: TimeRange): boolean =>
  overlapSeconds(x, y) >=
  0.5 * Math.min(x.endSeconds - x.startSeconds, y.endSeconds - y.startSeconds)

const median = (values: number[]): number => {
  const sorted = [...values].sort((x, y) => x - y)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1
    ? (sorted[middle] ?? 0)
    : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
}

/** The group of partner ranges around the one most of them agree with (longest on a tie). */
const consensus = (
  matches: { partner: string; range: TimeRange }[],
): { range: TimeRange; partners: string[] } | undefined => {
  let best: { pivot: TimeRange; group: typeof matches } | undefined
  for (const { range } of matches) {
    const group = matches.filter((other) => agrees(range, other.range))
    const longer =
      best !== undefined &&
      group.length === best.group.length &&
      range.endSeconds - range.startSeconds > best.pivot.endSeconds - best.pivot.startSeconds
    if (best === undefined || group.length > best.group.length || longer)
      best = { pivot: range, group }
  }
  if (best === undefined) return undefined
  return {
    range: {
      startSeconds: median(best.group.map(({ range }) => range.startSeconds)),
      endSeconds: median(best.group.map(({ range }) => range.endSeconds)),
    },
    partners: [...new Set(best.group.map(({ partner }) => partner))],
  }
}

/**
 * §12.3 steps 2, 3 and 5 over the fingerprints of one window (start or end) of every episode:
 * the corroborated segment of each episode, by key. Fewer than two episodes: nothing.
 */
export const detectSharedSegments = (
  episodes: readonly EpisodeFingerprint[],
  params: FingerprintParams,
): Map<string, DetectedSegment> => {
  const result = new Map<string, DetectedSegment>()
  if (episodes.length < 2) return result
  const indexes = episodes.map(({ points }) => indexFingerprint(points))
  const matches = new Map<string, { partner: string; range: TimeRange }[]>(
    episodes.map(({ key }) => [key, []]),
  )
  episodes.forEach((a, i) => {
    for (let j = i + 1; j < episodes.length; j++) {
      const b = episodes[j]
      const bIndex = indexes[j]
      if (b === undefined || bIndex === undefined) continue
      const run = findSharedRun(a.points, b.points, params, bIndex)
      if (run === undefined) continue
      matches.get(a.key)?.push({ partner: b.key, range: run.a })
      matches.get(b.key)?.push({ partner: a.key, range: run.b })
    }
  })
  for (const { key } of episodes) {
    const found = consensus(matches.get(key) ?? [])
    if (found === undefined) continue
    result.set(key, {
      ...found.range,
      confidence: found.partners.length / (episodes.length - 1),
      corroboratedBy: found.partners,
    })
  }
  return result
}

// ── Ports ──────────────────────────────────────────────────────────────────────────────────

export type FingerprintError = AppError<'segment/fingerprint_failed'>

/**
 * Raw Chromaprint fingerprint of `durationSeconds` of the first audio track of a file, from
 * `startSeconds`. The error context carries `reason: 'binary_missing'` when ffmpeg or fpcalc
 * cannot be run: nothing can be fingerprinted then, the job stops.
 */
export type AudioFingerprinter = {
  fingerprint: (input: {
    path: string
    startSeconds: number
    durationSeconds: number
    signal?: AbortSignal
  }) => Promise<Result<number[], FingerprintError>>
}

/** One file of the played version of an episode (several for a stack, §7.7). */
export type FingerprintPart = { path: string; durationMs: number }

/**
 * An episode of the season as fingerprinting sees it (one with a ready source in a
 * `detect_segments` library): the version playback would play (`rankVersions`), when all its
 * parts are on a reachable root with a probed duration and audio.
 */
export type FingerprintEpisode = {
  itemId: string
  /**
   * The version (`stack_group_id`, else the source id). Episodes sharing a file (`E01-E02`) share
   * it: the file is fingerprinted once and never corroborates itself.
   */
  fileKey: string
  /** In part order; at least one. */
  parts: FingerprintPart[]
}

export type FingerprintCatalog = {
  /** The episodes of the season (§12.3 "visibles": a ready source), in episode order. */
  listSeasonEpisodes: (seasonId: string) => FingerprintEpisode[]
  /** True while a `fetch_segments` job of an episode of the season is queued or running. */
  isChainPending: (seasonId: string) => boolean
}

export type FingerprintSettings = SegmentSettings['fingerprint']
export type FingerprintSettingsReader = { read: () => FingerprintSettings }
