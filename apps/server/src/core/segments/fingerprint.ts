import type { AppError, Result } from '@projo/shared'

import type { SegmentSettings } from '../settings/settings.ts'

export const chromaprintSampleRate = 11_025
export const chromaprintHopSamples = 1_365
export const pointSeconds = chromaprintHopSamples / chromaprintSampleRate

export const pointSpanSeconds = (4_096 + 19 * chromaprintHopSamples) / chromaprintSampleRate

export const runHeadSeconds = 0.6
export const runTailSeconds = 1.5

export type FingerprintParams = {
  minSeconds: number
  maxSeconds: number
  similarity: number
  maxGapSeconds?: number
}

export const defaultMaxGapSeconds = 3.5
const maxRepeatsPerValue = 16
const minShiftVotes = 2
const maxShiftCandidates = 24
const edgeWindowPoints = 8

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

const hitsAround = (hits: Uint8Array, at: number, direction: 1 | -1): number => {
  let count = 0
  for (let k = 0; k < edgeWindowPoints; k++) count += hits[at + direction * k] ?? 0
  return count
}

const trimRun = (hits: Uint8Array, run: Run): Run => {
  let { start, last } = run
  const minHits = edgeWindowPoints / 2
  while (start < last && (hits[start] === 0 || hitsAround(hits, start, 1) < minHits)) start++
  while (last > start && (hits[last] === 0 || hitsAround(hits, last, -1) < minHits)) last--
  let matched = 0
  for (let i = start; i <= last; i++) matched += hits[i] ?? 0
  return { start, last, matched }
}

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

export type FingerprintError = AppError<'segment/fingerprint_failed'>

export type AudioFingerprinter = {
  fingerprint: (input: {
    path: string
    startSeconds: number
    durationSeconds: number
    signal?: AbortSignal
  }) => Promise<Result<number[], FingerprintError>>
}

export type FingerprintPart = { path: string; durationMs: number }

export type FingerprintEpisode = {
  itemId: string
  fileKey: string
  parts: FingerprintPart[]
}

export type FingerprintCatalog = {
  listSeasonEpisodes: (seasonId: string) => FingerprintEpisode[]
  isChainPending: (seasonId: string) => boolean
}

export type FingerprintSettings = SegmentSettings['fingerprint']
export type FingerprintSettingsReader = { read: () => FingerprintSettings }
