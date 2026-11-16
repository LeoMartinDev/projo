import type { ItemSummaryDto, PlayTargetDto } from '@projo/shared/api/catalog'

import { progressRatioOf, remainingMsOf } from '../media/media.ts'

export type PlayProgress = { ratio: number; remainingMs?: number }

/**
 * Progress of the item a "Resume" button plays: from the target's own position and duration, or,
 * from a server that sends no duration (older than the bundled UI of the desktop app), from that
 * item's progress when it is loaded (`loaded`). Nothing for a "Play" target.
 */
export const playProgressOf = (
  play: PlayTargetDto | undefined,
  loaded: Pick<ItemSummaryDto, 'progress'> | undefined,
): PlayProgress | undefined => {
  if (play?.action !== 'resume') return undefined
  const { positionMs, durationMs } = play
  if (durationMs !== undefined && durationMs > 0) {
    return {
      ratio: Math.min(1, Math.max(0, positionMs / durationMs)),
      remainingMs: Math.max(0, durationMs - positionMs),
    }
  }
  const ratio = loaded === undefined ? undefined : progressRatioOf(loaded)
  if (loaded === undefined || ratio === undefined) return undefined
  const remainingMs = remainingMsOf(loaded)
  return remainingMs === undefined ? { ratio } : { ratio, remainingMs }
}
