import { mkdirSync } from 'node:fs'

import { appError, type AppError, err, ok, type Result } from '@projo/shared'

import { type DataPaths, requiredDirectories } from '../../core/data-paths.ts'

export const ensureDataLayout = (
  paths: DataPaths,
): Result<void, AppError<'data/layout_failed'>> => {
  for (const directory of requiredDirectories(paths)) {
    try {
      mkdirSync(directory, { recursive: true })
    } catch (cause) {
      return err(
        appError('data/layout_failed', 'cannot create data directory', {
          context: { directory },
          cause,
        }),
      )
    }
  }
  return ok()
}
