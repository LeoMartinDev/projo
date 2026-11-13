import { ok, type Result } from '@projo/shared'

import type { TrickplayIndex } from '../../core/playback/media-assets.ts'
import {
  freshTrickplay,
  type FreshTrickplayDeps,
  type TrickplayAccessError,
  trickplayNotFound,
} from './shared/fresh-trickplay.ts'

export const getTrickplayIndexFactory = (deps: FreshTrickplayDeps) => {
  const fresh = freshTrickplay(deps)
  return ({
    sourceId,
    profileId,
  }: {
    sourceId: string
    profileId: string
  }): Result<TrickplayIndex, TrickplayAccessError> => {
    const stored = fresh(sourceId, profileId)
    return stored === undefined ? trickplayNotFound(sourceId) : ok(stored.index)
  }
}

export type GetTrickplayIndex = ReturnType<typeof getTrickplayIndexFactory>
