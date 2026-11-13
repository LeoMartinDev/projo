import { appError, type AppError, err, ok, type Result } from '@projo/shared'

import { type MissingSourcePurgeDeps, purgeSources } from './shared/missing-source-purge.ts'

export type PurgeMissingSourceError = AppError<'source/not_found' | 'source/not_missing'>

export const purgeMissingSourceFactory =
  (deps: MissingSourcePurgeDeps) =>
  ({ sourceId }: { sourceId: string }): Result<void, PurgeMissingSourceError> => {
    const state = deps.missingSources.stateOf(sourceId)
    if (state === undefined)
      return err(appError('source/not_found', 'source not found', { context: { sourceId } }))
    if (state !== 'missing')
      return err(
        appError('source/not_missing', 'only a missing source can be purged', {
          context: { sourceId, state },
        }),
      )
    purgeSources(deps, [sourceId])
    return ok()
  }

export type PurgeMissingSource = ReturnType<typeof purgeMissingSourceFactory>
