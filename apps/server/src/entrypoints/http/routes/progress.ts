import { type Context, Hono } from 'hono'

import {
  type HideFromContinueResponse,
  type ItemProgressDto,
  type ProgressResponse,
  progressUpdateSchema,
  type WatchStatusDto,
} from '@projo/shared/api/progress'

import type { HideFromContinue } from '../../../application/progress/hide-from-continue.ts'
import type { ProgressView } from '../../../application/progress/progress-views.ts'
import type { RecordProgress } from '../../../application/progress/record-progress.ts'
import type { SetWatched } from '../../../application/progress/set-watched.ts'
import type { VisibilityScopeResolver } from '../../../core/catalog/catalog.ts'
import {
  type ItemProgress,
  progressState,
  resumePositionMs,
  type WatchStatus,
} from '../../../core/progress/progress.ts'
import type { AppEnv } from '../context.ts'
import { respondError } from '../errors.ts'
import { currentProfileId } from '../principal.ts'
import { validate } from '../validation.ts'

export const toItemProgressDto = (progress: ItemProgress | undefined): ItemProgressDto => ({
  state: progressState(progress),
  watched: progress?.watched ?? false,
  positionMs: progress?.positionMs ?? 0,
  durationMs: progress?.durationMs ?? 0,
  resumePositionMs: resumePositionMs(progress),
  playCount: progress?.playCount ?? 0,
  ...(progress === undefined ? {} : { lastPlayedAt: progress.lastPlayedAt.toISOString() }),
  ...(progress?.watchedAt === undefined ? {} : { watchedAt: progress.watchedAt.toISOString() }),
})

export const toWatchStatusDto = (status: WatchStatus): WatchStatusDto => ({ ...status })

/** `progress` on movies and episodes, `watchStatus` on seasons and series. */
export const progressFields = (
  view: ProgressView | undefined,
): { progress?: ItemProgressDto; watchStatus?: WatchStatusDto } => {
  if (view === undefined) return {}
  return view.kind === 'playable'
    ? { progress: toItemProgressDto(view.progress) }
    : { watchStatus: toWatchStatusDto(view.status) }
}

type Deps = {
  recordProgress: RecordProgress
  setWatched: SetWatched
  hideFromContinue: HideFromContinue
  /** What the active profile may see (§14: library access, content rating). */
  scopeFor: VisibilityScopeResolver
}

/**
 * §17.2 Progression: `/items/:id/progress`, `/items/:id/watched` (movie, episode, or every
 * visible episode of a season or a series), `/items/:id/hide-from-continue` ("My list" is in
 * `watchlist.ts`). Mounted at `/api/v1`. Middleware: per route or path-scoped, never `.use('*')`
 * (the sub-app is mounted at a shared prefix, a wildcard would leak to every other domain).
 */
export const progressRoutes = ({
  recordProgress,
  setWatched,
  hideFromContinue,
  scopeFor,
}: Deps) => {
  const watched = (value: boolean) => async (c: Context<AppEnv, '/items/:id/watched'>) => {
    const profileId = currentProfileId(c)
    if (!profileId.ok) return respondError(c, profileId.error)
    const itemId = c.req.param('id')
    const result = await setWatched({
      profileId: profileId.value,
      itemId,
      watched: value,
      scope: scopeFor(profileId.value),
    })
    return result.ok
      ? c.json({ itemId, ...progressFields(result.value) } satisfies ProgressResponse, 200)
      : respondError(c, result.error)
  }

  return new Hono<AppEnv>()
    .put('/items/:id/progress', validate('json', progressUpdateSchema), async (c) => {
      const profileId = currentProfileId(c)
      if (!profileId.ok) return respondError(c, profileId.error)
      const itemId = c.req.param('id')
      const result = await recordProgress({
        profileId: profileId.value,
        itemId,
        ...c.req.valid('json'),
        scope: scopeFor(profileId.value),
      })
      return result.ok
        ? c.json(
            { itemId, progress: toItemProgressDto(result.value) } satisfies ProgressResponse,
            200,
          )
        : respondError(c, result.error)
    })
    .post('/items/:id/watched', watched(true))
    .delete('/items/:id/watched', watched(false))
    .post('/items/:id/hide-from-continue', async (c) => {
      const profileId = currentProfileId(c)
      if (!profileId.ok) return respondError(c, profileId.error)
      const itemId = c.req.param('id')
      const result = await hideFromContinue({
        profileId: profileId.value,
        itemId,
        scope: scopeFor(profileId.value),
      })
      return result.ok
        ? c.json({ itemId, hiddenItemId: result.value } satisfies HideFromContinueResponse, 200)
        : respondError(c, result.error)
    })
}

export type ProgressRoutes = ReturnType<typeof progressRoutes>
