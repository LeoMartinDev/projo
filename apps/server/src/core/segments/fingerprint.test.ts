import { describe, expect, test } from 'bun:test'

import {
  detectSharedSegments,
  findSharedRun,
  maxBitErrors,
  pointSeconds,
  popcount32,
  runHeadSeconds,
  runTailSeconds,
} from './fingerprint.ts'

/** Deterministic 32-bit generator (mulberry32). */
const random = (seed: number) => {
  let state = seed >>> 0
  return (): number => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return (t ^ (t >>> 14)) >>> 0
  }
}

const noise = (length: number, seed: number): number[] => {
  const next = random(seed)
  return Array.from({ length }, () => next())
}

/** Flips `bits` distinct random bits of a share of the points; another share is replaced. */
const degrade = (
  values: number[],
  {
    seed,
    share = 0.3,
    bits = 4,
    replaced = 0,
  }: { seed: number; share?: number; bits?: number; replaced?: number },
): number[] => {
  const next = random(seed)
  return values.map((value) => {
    const roll = next() / 2 ** 32
    if (roll < replaced) return next()
    if (roll >= replaced + share) return value
    const positions = new Set<number>()
    while (positions.size < bits) positions.add(next() % 32)
    return [...positions].reduce((flipped, bit) => (flipped ^ (1 << bit)) >>> 0, value)
  })
}

const points = (seconds: number) => Math.round(seconds / pointSeconds)
const params = { minSeconds: 15, maxSeconds: 150, similarity: 0.8 }

/** Where a passage of `length` points at position `at` is expected to be reported. */
const expected = (at: number, length: number) => ({
  startSeconds: at === 0 ? 0 : at * pointSeconds + runHeadSeconds,
  endSeconds: (at + length - 1) * pointSeconds + runTailSeconds,
})

const episode = (before: number, shared: number[], after: number, seed: number) => [
  ...noise(before, seed),
  ...shared,
  ...noise(after, seed + 1),
]

describe('bits', () => {
  test('popcount of 32-bit values', () => {
    expect(popcount32(0)).toBe(0)
    expect(popcount32(0xffffffff)).toBe(32)
    expect(popcount32(0x80000001)).toBe(2)
    expect(popcount32(-1)).toBe(32)
  })

  test('similarity 0.8 allows 6 differing bits (Intro Skipper)', () => {
    expect(maxBitErrors(0.8)).toBe(6)
    expect(maxBitErrors(1)).toBe(0)
    expect(maxBitErrors(0.7)).toBe(9)
  })
})

describe('findSharedRun (§12.3 step 2)', () => {
  const intro = noise(points(25), 99)

  test('finds a shared passage at different offsets in both fingerprints', () => {
    const a = episode(40, intro, 300, 1)
    const b = episode(130, intro, 200, 3)
    const run = findSharedRun(a, b, params)
    expect(run?.a.startSeconds).toBeCloseTo(expected(40, intro.length).startSeconds, 5)
    expect(run?.a.endSeconds).toBeCloseTo(expected(40, intro.length).endSeconds, 5)
    expect(run?.b.startSeconds).toBeCloseTo(expected(130, intro.length).startSeconds, 5)
    expect(run?.b.endSeconds).toBeCloseTo(expected(130, intro.length).endSeconds, 5)
  })

  test('a passage at the very start of the window starts at 0', () => {
    const run = findSharedRun(episode(0, intro, 100, 1), episode(50, intro, 100, 3), params)
    expect(run?.a.startSeconds).toBe(0)
  })

  test('survives noise: flipped bits and replaced points', () => {
    const a = episode(60, degrade(intro, { seed: 5, share: 0.4, bits: 3, replaced: 0.1 }), 200, 1)
    const b = episode(10, degrade(intro, { seed: 6, share: 0.4, bits: 3, replaced: 0.1 }), 200, 3)
    const run = findSharedRun(a, b, params)
    expect(Math.abs((run?.a.startSeconds ?? -9) - 60 * pointSeconds)).toBeLessThan(1)
    expect(Math.abs((run?.a.endSeconds ?? -9) - (60 + intro.length) * pointSeconds)).toBeLessThan(
      1.5,
    )
    expect(Math.abs((run?.b.startSeconds ?? -9) - 10 * pointSeconds)).toBeLessThan(1)
  })

  test('points further apart than the similarity threshold do not match', () => {
    // Every point 7 bits away, but one in ten left exact: they vote for the shift (step 1).
    const blurred = degrade(intro, { seed: 8, share: 1, bits: 7 }).map((value, i) =>
      i % 10 === 0 ? (intro[i] ?? 0) : value,
    )
    const a = episode(20, intro, 100, 1)
    const b = episode(20, blurred, 100, 3)
    expect(findSharedRun(a, b, params)).toBeUndefined()
    // 8 bits allowed at 0.75.
    expect(findSharedRun(a, b, { ...params, similarity: 0.75 })).toBeDefined()
  })

  test('nothing in common', () => {
    expect(findSharedRun(noise(800, 1), noise(800, 2), params)).toBeUndefined()
  })

  test('a passage shorter than minSeconds is ignored', () => {
    const short = noise(points(10), 42)
    expect(findSharedRun(episode(30, short, 200, 1), episode(80, short, 200, 3), params)).toBe(
      undefined,
    )
  })

  test('a passage longer than maxSeconds is discarded, not truncated', () => {
    const long = noise(points(200), 42)
    expect(findSharedRun(episode(30, long, 200, 1), episode(80, long, 200, 3), params)).toBe(
      undefined,
    )
    expect(
      findSharedRun(episode(30, long, 200, 1), episode(80, long, 200, 3), {
        ...params,
        maxSeconds: 250,
      }),
    ).toBeDefined()
  })

  test('a gap up to 3.5 s stays one run; a longer one splits it', () => {
    const half = points(12)
    const first = intro.slice(0, half)
    const second = intro.slice(half, half * 2)
    const withGap = (gapSeconds: number, seed: number) => [
      ...first,
      ...noise(points(gapSeconds), seed),
      ...second,
    ]
    const short = findSharedRun(
      episode(20, withGap(2, 7), 100, 1),
      episode(50, withGap(2, 8), 100, 3),
      params,
    )
    expect(short?.a.startSeconds).toBeCloseTo(expected(20, 1).startSeconds, 5)
    expect(short?.a.endSeconds).toBeCloseTo(expected(20, 2 * half + points(2)).endSeconds, 5)
    // 12 s halves apart from each other: each one is under 15 s.
    expect(
      findSharedRun(episode(20, withGap(6, 7), 100, 1), episode(50, withGap(6, 8), 100, 3), params),
    ).toBeUndefined()
  })

  test('an isolated coincidence after the passage does not stretch it', () => {
    const after = noise(100, 11)
    const tail = noise(100, 12)
    // One point equal 2 s after the end, within the gap tolerance.
    tail[points(2)] = after[points(2)] ?? 0
    const a = [...noise(30, 1), ...intro, ...after]
    const b = [...noise(70, 3), ...intro, ...tail]
    const run = findSharedRun(a, b, params)
    expect(run?.a.endSeconds).toBeCloseTo(expected(30, intro.length).endSeconds, 5)
  })
})

describe('detectSharedSegments (§12.3 steps 3 and 5)', () => {
  const intro = noise(points(30), 77)

  test('each episode gets the passage, confidence = share of corroborating episodes', () => {
    const episodes = [
      { key: 'e1', points: episode(10, intro, 400, 1) },
      { key: 'e2', points: episode(85, intro, 300, 3) },
      { key: 'e3', points: episode(160, intro, 200, 5) },
      { key: 'cold-open', points: noise(600, 9) },
    ]
    const found = detectSharedSegments(episodes, params)
    expect([...found.keys()].sort()).toEqual(['e1', 'e2', 'e3'])
    expect(found.get('e2')).toMatchObject({ confidence: 2 / 3, corroboratedBy: ['e1', 'e3'] })
    expect(found.get('e2')?.startSeconds).toBeCloseTo(expected(85, intro.length).startSeconds, 5)
    expect(found.get('e3')?.endSeconds).toBeCloseTo(expected(160, intro.length).endSeconds, 5)
  })

  test('two episodes corroborate each other', () => {
    const found = detectSharedSegments(
      [
        { key: 'e1', points: episode(10, intro, 100, 1) },
        { key: 'e2', points: episode(50, intro, 100, 3) },
      ],
      params,
    )
    expect(found.get('e1')?.confidence).toBe(1)
    expect(found.get('e2')?.confidence).toBe(1)
  })

  test('the range most partners agree on wins over an outlier', () => {
    const recap = noise(points(40), 55)
    const episodes = [
      // e1 shares a recap with e2 only, longer than the intro: the pair's answer is the recap.
      {
        key: 'e1',
        points: [...noise(20, 1), ...intro, ...noise(40, 2), ...recap, ...noise(50, 3)],
      },
      { key: 'e2', points: [...noise(60, 4), ...recap, ...noise(40, 5), ...intro, ...noise(9, 6)] },
      { key: 'e3', points: episode(120, intro, 50, 7) },
      { key: 'e4', points: episode(5, intro, 80, 9) },
    ]
    const found = detectSharedSegments(episodes, params)
    expect(found.get('e1')?.startSeconds).toBeCloseTo(expected(20, intro.length).startSeconds, 5)
    expect(found.get('e1')?.confidence).toBe(2 / 3)
  })

  test('a single episode: nothing (§12.3 "2 épisodes minimum")', () => {
    expect(
      detectSharedSegments([{ key: 'e1', points: episode(10, intro, 100, 1) }], params).size,
    ).toBe(0)
    expect(detectSharedSegments([], params).size).toBe(0)
  })
})
