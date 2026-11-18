import type { TvGrabFailureReason, TvSnapshotCandidate } from './snapshot.ts'

const minute = 60_000
const hour = 60 * minute

/** Timings of the channel snapshots (§29.4). */
export const snapshotTimings = {
  /** A running stream gives a snapshot at most this often. */
  freeEveryMs: 5 * minute,
  /** Snapshots from running streams made at once, in all. */
  freeConcurrency: 2,
  /** A channel without a stream is grabbed again once its snapshot is this old. */
  grabEveryMs: 15 * minute,
  /** The task starting the grabs runs this often. */
  tickMs: 5_000,
  /** The budget's window: grabs started in the last hour count. */
  budgetWindowMs: hour,
  /** Least time between two connections to a source, plus a random part up to `jitterMs`. */
  sourceGapMs: 10_000,
  jitterMs: 5_000,
  /** A channel's next grab after 1, 2, then 3 or more consecutive failures. */
  backoffMs: [hour, 6 * hour, 24 * hour] as readonly number[],
  /** Consecutive refusals of a source that pause its grabs, and for how long. */
  refusalsBeforePause: 3,
  pauseMs: hour,
  /** A TV page's hint is kept this long. */
  hintMs: 5 * minute,
  /** A channel watched this recently comes before the rest. */
  watchedWithinMs: 7 * 24 * hour,
} as const

/** Whether a running stream may give its channel a snapshot now (§29.4). */
export const isFreeSnapshotDue = ({
  lastAtMs,
  nowMs,
}: {
  /** The channel's last snapshot, or the last try from a stream, whichever is newer. */
  lastAtMs: number | undefined
  nowMs: number
}): boolean => lastAtMs === undefined || nowMs - lastAtMs >= snapshotTimings.freeEveryMs

/**
 * When a channel may be grabbed again (§29.4): at once without a snapshot nor a failure; 15
 * minutes after its snapshot; after failures, 1, 6, then 24 hours after the last attempt.
 */
export const grabDueAtMs = (candidate: TvSnapshotCandidate): number => {
  const fresh =
    (candidate.snapshotAt?.getTime() ?? Number.NEGATIVE_INFINITY) + snapshotTimings.grabEveryMs
  if (candidate.failures <= 0 || candidate.attemptAt === undefined) return fresh
  const backoffs = snapshotTimings.backoffMs
  const backoff = backoffs[Math.min(candidate.failures, backoffs.length) - 1] ?? 0
  return Math.max(fresh, candidate.attemptAt.getTime() + backoff)
}

/** What decides a due channel's turn: what a page shows, favourites, recently watched, the rest. */
export type GrabPriorities = {
  visible: ReadonlySet<string>
  favorites: ReadonlySet<string>
  /** A channel with a stream gives free snapshots: never grabbed. */
  streaming: (channelId: string) => boolean
}

const tierOf = (
  candidate: TvSnapshotCandidate,
  { visible, favorites }: GrabPriorities,
  nowMs: number,
): number => {
  if (visible.has(candidate.id)) return 0
  if (favorites.has(candidate.id)) return 1
  const watched = candidate.watchedAt?.getTime()
  if (watched !== undefined && nowMs - watched <= snapshotTimings.watchedWithinMs) return 2
  return 3
}

/**
 * The channel to grab next among a source's `candidates` (in the page's order), §29.4: a due
 * one without a stream, by tier (shown on a TV page, a favourite, watched in the last 7 days,
 * the rest), then the stalest (never snapshotted first), then the page's order.
 */
export const pickSnapshotChannel = ({
  candidates,
  nowMs,
  priorities,
}: {
  candidates: readonly TvSnapshotCandidate[]
  nowMs: number
  priorities: GrabPriorities
}): TvSnapshotCandidate | undefined => {
  let best: { candidate: TvSnapshotCandidate; tier: number; age: number } | undefined
  for (const candidate of candidates) {
    if (grabDueAtMs(candidate) > nowMs || priorities.streaming(candidate.id)) continue
    const tier = tierOf(candidate, priorities, nowMs)
    const age = candidate.snapshotAt?.getTime() ?? Number.NEGATIVE_INFINITY
    if (best === undefined || tier < best.tier || (tier === best.tier && age < best.age))
      best = { candidate, tier, age }
  }
  return best?.candidate
}

/** A source's grabs as they stand (§29.4), held in memory by the grabs component. */
export type SourceGrabState = {
  /** A grab of the source under way. */
  running: boolean
  /** When the grabs of the last hour started, oldest first. */
  startedAtMs: readonly number[]
  /** The spacing drawn for the source's next connection: 10 s plus up to 5 s. */
  gapMs: number
  /** Consecutive refusals; 3 pause the source. */
  refusals: number
  pausedUntilMs?: number
}

export const initialSourceGrabState = (random: number): SourceGrabState => ({
  running: false,
  startedAtMs: [],
  gapMs: gapOf(random),
  refusals: 0,
})

const gapOf = (random: number): number =>
  snapshotTimings.sourceGapMs +
  Math.floor(Math.min(1, Math.max(0, random)) * snapshotTimings.jitterMs)

export type SourceGrabBlock = 'running' | 'paused' | 'budget' | 'spacing'

/**
 * Why a source cannot start a grab now (§29.4), `undefined` when it may: one at a time, not
 * while paused, fewer than `grabsPerHour` started in the last hour, and its spacing since the
 * source's last connection (a grab's or a stream's).
 */
export const sourceGrabBlock = ({
  state,
  nowMs,
  grabsPerHour,
  lastConnectionAtMs,
}: {
  state: SourceGrabState
  nowMs: number
  grabsPerHour: number
  lastConnectionAtMs: number | undefined
}): SourceGrabBlock | undefined => {
  if (state.running) return 'running'
  if (state.pausedUntilMs !== undefined && nowMs < state.pausedUntilMs) return 'paused'
  const recent = state.startedAtMs.filter(
    (at) => nowMs - at < snapshotTimings.budgetWindowMs,
  ).length
  if (recent >= grabsPerHour) return 'budget'
  if (lastConnectionAtMs !== undefined && nowMs - lastConnectionAtMs < state.gapMs) return 'spacing'
  return undefined
}

/** The state once a grab starts at `nowMs`: its budget counted, a new spacing drawn. */
export const grabStarted = (
  state: SourceGrabState,
  nowMs: number,
  random: number,
): SourceGrabState => ({
  ...state,
  running: true,
  startedAtMs: [
    ...state.startedAtMs.filter((at) => nowMs - at < snapshotTimings.budgetWindowMs),
    nowMs,
  ],
  gapMs: gapOf(random),
})

/** Whether a failure is the source refusing projo (§29.4): it counts towards the pause. */
export const isSourceRefusal = (reason: TvGrabFailureReason): boolean =>
  reason === 'refused' || reason === 'timeout'

/**
 * The state once a grab ends (§29.4): a success resets the refusals; the third consecutive
 * refusal pauses the source for an hour (`paused` tells the caller to log it); any other
 * failure, or a grab stopped (evicted, turned off), leaves the count.
 */
export const grabEnded = (
  state: SourceGrabState,
  outcome: { ok: true } | { ok: false; reason: TvGrabFailureReason } | { stopped: true },
  nowMs: number,
): { state: SourceGrabState; paused: boolean } => {
  const done = { ...state, running: false }
  if ('stopped' in outcome) return { state: done, paused: false }
  if (outcome.ok) return { state: { ...done, refusals: 0 }, paused: false }
  if (!isSourceRefusal(outcome.reason)) return { state: done, paused: false }
  const refusals = state.refusals + 1
  if (refusals < snapshotTimings.refusalsBeforePause)
    return { state: { ...done, refusals }, paused: false }
  return {
    state: { ...done, refusals: 0, pausedUntilMs: nowMs + snapshotTimings.pauseMs },
    paused: true,
  }
}
