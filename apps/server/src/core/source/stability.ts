import { MIN_VIDEO_SIZE_BYTES } from '../naming/index.ts'
import type { PendingReason } from './source.ts'

export type ObservedFile = { sizeBytes: number; mtimeMs: number }

export type StabilityInput = {
  /** What was last recorded for the pending source. */
  recorded: ObservedFile & {
    pendingReason: PendingReason
    /** Since when `recorded` has been observed unchanged. Absent: never observed, the counter starts now. */
    unchangedSince?: Date
    stableSince?: Date
  }
  /** Fresh `stat`, or `undefined` when the file is gone (the scan will mark it missing). */
  observed: ObservedFile | undefined
  now: Date
  quietPeriodMs: number
}

export type StabilityDecision =
  /** File gone: nothing to do here, the next scan decides (§7.5). */
  | { kind: 'gone' }
  /** Size or mtime moved: the counter restarts (§7.3 step 3). */
  | { kind: 'changed'; sizeBytes: number; mtimeMs: number; reason: 'growing' | 'too_small' }
  /** Unchanged, quiet period not over yet. `startCounter`: `unchangedSince` must be set to `now`. */
  | { kind: 'waiting'; remainingMs: number; startCounter: boolean }
  /** Unchanged for the whole quiet period: `stable_since` is set, the probe can run. */
  | { kind: 'stable'; stableSince: Date }
  /** Probe or decode failed on these exact bytes: only a change re-runs the pipeline (or the next scan). */
  | { kind: 'failed' }

/**
 * §7.3 step 3, the stat-only stability check run every 30 s by `watch_pending`. Both size **and**
 * mtime must hold still: with pre-allocation (qBittorrent) the size is final from the start and
 * only the mtime moves.
 */
export const decideStability = ({
  recorded,
  observed,
  now,
  quietPeriodMs,
}: StabilityInput): StabilityDecision => {
  if (observed === undefined) return { kind: 'gone' }
  const changed = observed.sizeBytes !== recorded.sizeBytes || observed.mtimeMs !== recorded.mtimeMs
  if (changed) {
    return {
      kind: 'changed',
      sizeBytes: observed.sizeBytes,
      mtimeMs: observed.mtimeMs,
      reason: observed.sizeBytes < MIN_VIDEO_SIZE_BYTES ? 'too_small' : 'growing',
    }
  }
  if (recorded.pendingReason === 'probe_failed' || recorded.pendingReason === 'decode_failed') {
    return { kind: 'failed' }
  }
  if (recorded.pendingReason === 'too_small') {
    // Never probed while under the minimum size; it leaves this state by growing.
    return { kind: 'waiting', remainingMs: quietPeriodMs, startCounter: false }
  }
  if (recorded.stableSince !== undefined)
    return { kind: 'stable', stableSince: recorded.stableSince }
  if (recorded.unchangedSince === undefined) {
    return quietPeriodMs <= 0
      ? { kind: 'stable', stableSince: now }
      : { kind: 'waiting', remainingMs: quietPeriodMs, startCounter: true }
  }
  const elapsed = now.getTime() - recorded.unchangedSince.getTime()
  if (elapsed >= quietPeriodMs) return { kind: 'stable', stableSince: now }
  return { kind: 'waiting', remainingMs: quietPeriodMs - elapsed, startCounter: false }
}
