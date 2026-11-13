import type { Clock } from '../../core/clock.ts'
import type { JobQueue } from '../../core/jobs/ports.ts'
import type { MediaAssetCatalog } from '../../core/playback/media-assets.ts'
import type { GetPreviewClip } from './get-preview-clip.ts'
import { requestPreviewClip } from './shared/preview-clip-requests.ts'

const requestCooldownMs = 6 * 60 * 60_000

/**
 * The preview clips of the home page: ready ones get a URL, missing ones are asked for, at most
 * once per item every 6 hours (the times of the last requests and checks are kept in memory).
 */
export const homePreviewsFactory = ({
  previewAccess,
  mediaCatalog,
  jobQueue,
  clock,
}: {
  previewAccess: GetPreviewClip
  mediaCatalog: Pick<MediaAssetCatalog, 'previewTargetOf'>
  jobQueue: JobQueue
  clock: Clock
}) => {
  const requestedAt = new Map<string, number>()
  const checkedAt = new Map<string, number>()
  const request = (itemId: string, ready: boolean): void => {
    const now = clock.now().getTime()
    const last = requestedAt.get(itemId)
    if (ready || (last !== undefined && now - last < requestCooldownMs)) return
    requestedAt.set(itemId, now)
    const target = mediaCatalog.previewTargetOf(itemId)
    if (target !== undefined) requestPreviewClip(jobQueue, target.id)
  }
  return {
    previewUrl: ({ itemId, profileId }: { itemId: string; profileId: string }) => {
      const ready = previewAccess({ itemId, profileId }).ok
      request(itemId, ready)
      return ready ? `/api/v1/previews/${encodeURIComponent(itemId)}.mp4` : undefined
    },
    prepare: ({ itemIds, profileId }: { itemIds: readonly string[]; profileId: string }) => {
      const now = clock.now().getTime()
      for (const itemId of itemIds) {
        const last = checkedAt.get(itemId)
        if (last !== undefined && now - last < requestCooldownMs) continue
        checkedAt.set(itemId, now)
        const target = mediaCatalog.previewTargetOf(itemId)
        if (target === undefined) continue
        request(target.id, previewAccess({ itemId: target.id, profileId }).ok)
      }
    },
  }
}

export type HomePreviews = ReturnType<typeof homePreviewsFactory>
