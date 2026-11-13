import { ok, type Result } from '@projo/shared'

import type { MediaError } from '../../core/media/probe.ts'
import { trickplayInstantAt } from '../../core/playback/media-assets.ts'
import {
  freshTrickplay,
  type FreshTrickplayDeps,
  type TrickplayAccessError,
  trickplayNotFound,
} from './shared/fresh-trickplay.ts'

export const getTrickplayFrameFactory = (deps: FreshTrickplayDeps) => {
  const { playableSources, trickplayStore } = deps
  const fresh = freshTrickplay(deps)
  return async ({
    sourceId,
    second,
    profileId,
  }: {
    sourceId: string
    second: number
    profileId: string
  }): Promise<Result<string, TrickplayAccessError | MediaError>> => {
    const stored = fresh(sourceId, profileId)
    const source = stored === undefined ? undefined : playableSources.findSource(sourceId)
    const video = source?.media?.video[0]
    const durationS = (source?.media?.durationMs ?? 0) / 1000
    if (
      stored === undefined ||
      source === undefined ||
      video === undefined ||
      trickplayInstantAt(stored.index, second, durationS) !== second
    ) {
      return trickplayNotFound(sourceId)
    }
    const path = await trickplayStore.framePath({
      sourceId,
      path: source.path,
      videoStreamIndex: video.index,
      second,
    })
    if (!path.ok) return path
    return path.value === undefined ? trickplayNotFound(sourceId) : ok(path.value)
  }
}

export type GetTrickplayFrame = ReturnType<typeof getTrickplayFrameFactory>
