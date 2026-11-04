import { MIN_VIDEO_SIZE_BYTES } from '../naming/index.ts'
import type { PendingReason } from './source.ts'

export type ObservedFile = { sizeBytes: number; mtimeMs: number }

export type StabilityInput = {
  recorded: ObservedFile & {
    pendingReason: PendingReason
    unchangedSince?: Date
    stableSince?: Date
  }
  observed: ObservedFile | undefined
  now: Date
  quietPeriodMs: number
}

export type StabilityDecision =
  | { kind: 'gone' }
  | { kind: 'changed'; sizeBytes: number; mtimeMs: number; reason: 'growing' | 'too_small' }
  | { kind: 'waiting'; remainingMs: number; startCounter: boolean }
  | { kind: 'stable'; stableSince: Date }
  | { kind: 'failed' }

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
