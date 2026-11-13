import { ok, type Result } from '@projo/shared'

import {
  freshTrickplay,
  type FreshTrickplayDeps,
  type TrickplayAccessError,
  trickplayNotFound,
} from './shared/fresh-trickplay.ts'

export const getTrickplaySheetFactory = (deps: FreshTrickplayDeps) => {
  const fresh = freshTrickplay(deps)
  return ({
    sourceId,
    sheet,
    profileId,
  }: {
    sourceId: string
    sheet: number
    profileId: string
  }): Result<string, TrickplayAccessError> => {
    if (fresh(sourceId, profileId) === undefined) return trickplayNotFound(sourceId)
    const path = deps.trickplayStore.sheetPath({ sourceId, sheet })
    return path === undefined ? trickplayNotFound(sourceId) : ok(path)
  }
}

export type GetTrickplaySheet = ReturnType<typeof getTrickplaySheetFactory>
