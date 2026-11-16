import { progressRatioOf, remainingMsOf } from '@projo/i18n/media'
import type { ItemSummaryDto, PlayTargetDto } from '@projo/shared/api/catalog'

export type ResumeProgress = { ratio: number; remainingMs: number }

// The play target carries its own duration, so the line shows whatever season is selected; older
// servers leave it out and only the listed episode knows it.
export const resumeProgressOf = (
  play: Pick<PlayTargetDto, 'action' | 'itemId' | 'positionMs' | 'durationMs'> | undefined,
  listed: readonly Pick<ItemSummaryDto, 'id' | 'progress'>[],
): ResumeProgress | undefined => {
  if (play === undefined) return undefined
  if (play.action === 'resume' && play.durationMs !== undefined && play.durationMs > 0)
    return {
      ratio: Math.min(1, Math.max(0, play.positionMs / play.durationMs)),
      remainingMs: Math.max(0, play.durationMs - play.positionMs),
    }
  const playing = listed.find((item) => item.id === play.itemId)
  if (playing === undefined) return undefined
  const ratio = progressRatioOf(playing)
  const remainingMs = remainingMsOf(playing)
  return ratio === undefined || remainingMs === undefined ? undefined : { ratio, remainingMs }
}
