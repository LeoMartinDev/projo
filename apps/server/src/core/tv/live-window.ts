/**
 * The replay window of the live streams (§29.4, timeshift): the clock of its segments, their
 * retention once out of it, and the live cache's cap. Pure.
 */

/**
 * The starts (ms since the epoch) of the segments a run's poll lists for the first time. The
 * run's first segments end now (the relay's clock at the poll, minus their durations); the
 * others follow the run's previous segment. Never before the stream's previous segment ends.
 */
export const segmentStartsOf = ({
  durationsS,
  nowMs,
  firstOfRun,
  previousEndMs,
}: {
  durationsS: readonly number[]
  nowMs: number
  /** The run lists segments for the first time: its clock is anchored now. */
  firstOfRun: boolean
  /** The end of the stream's previous segment (of this run or an earlier one). */
  previousEndMs: number | undefined
}): number[] => {
  const totalMs = durationsS.reduce((sum, durationS) => sum + durationS * 1000, 0)
  const anchored = firstOfRun || previousEndMs === undefined ? nowMs - totalMs : previousEndMs
  let at = Math.round(previousEndMs === undefined ? anchored : Math.max(anchored, previousEndMs))
  return durationsS.map((durationS) => {
    const start = at
    at += Math.round(durationS * 1000)
    return start
  })
}

/** How long a segment out of the window stays on disk (§29.4): its duration plus 30 s. */
export const liveExpiredGraceS = 30

/** When a segment that left the window at `leftAtMs` may be deleted (`graceS`: tests only). */
export const expiredDeletionAt = (
  segment: { durationS: number },
  leftAtMs: number,
  graceS = liveExpiredGraceS,
): number => leftAtMs + Math.round((segment.durationS + graceS) * 1000)

/** A window never shortened by the cache's cap below its newest seconds (§29.4). */
export const liveWindowFloorS = 30

type CappedSegment = { startMs: number; durationS: number; bytes: number }

/**
 * How many of their oldest segments the streams' windows give up so that the live cache holds
 * at most `capBytes` (§29.4): the oldest segment of all streams first, never shortening a window
 * below its newest `liveWindowFloorS` seconds. Streams that keep everything are left out.
 */
export const cacheTrimOf = (
  windows: ReadonlyMap<string, readonly CappedSegment[]>,
  capBytes: number,
): Map<string, number> => {
  let total = 0
  const states = [...windows].map(([key, window]) => {
    let durationS = 0
    for (const segment of window) {
      total += segment.bytes
      durationS += segment.durationS
    }
    return { key, window, dropped: 0, durationS }
  })
  const trimmed = new Map<string, number>()
  while (total > capBytes) {
    let oldest: (typeof states)[number] | undefined
    for (const state of states) {
      const candidate = state.window[state.dropped]
      if (candidate === undefined || state.durationS - candidate.durationS < liveWindowFloorS)
        continue
      const best = oldest?.window[oldest.dropped]
      if (best === undefined || candidate.startMs < best.startMs) oldest = state
    }
    const segment = oldest?.window[oldest.dropped]
    if (oldest === undefined || segment === undefined) break
    oldest.dropped += 1
    oldest.durationS -= segment.durationS
    total -= segment.bytes
    trimmed.set(oldest.key, oldest.dropped)
  }
  return trimmed
}
