import { appError, type AppError, err } from '@projo/shared'

import type { PlayableSources } from '../../../core/catalog/catalog.ts'
import { sameFingerprint, type TrickplayStore } from '../../../core/playback/media-assets.ts'
import type { SourceAccess } from './source-access.ts'
import { sourceFingerprint } from './source-fingerprint.ts'

export type TrickplayAccessError = AppError<'playback/trickplay_not_found'>

export type FreshTrickplayDeps = {
  playableSources: Pick<PlayableSources, 'findSource'>
  trickplayStore: TrickplayStore
  canAccessSource: SourceAccess
}

export const trickplayNotFound = (sourceId: string) =>
  err(
    appError('playback/trickplay_not_found', 'no trickplay for this source', {
      context: { sourceId },
    }),
  )

/** The stored sprites of a source the profile sees, if they match the file as it is now. */
export const freshTrickplay =
  ({ playableSources, trickplayStore, canAccessSource }: FreshTrickplayDeps) =>
  (sourceId: string, profileId: string) => {
    if (!canAccessSource({ sourceId, profileId })) return undefined
    const source = playableSources.findSource(sourceId)
    const stored = source === undefined ? undefined : trickplayStore.read(sourceId)
    return source !== undefined &&
      stored !== undefined &&
      sameFingerprint(stored.fingerprint, sourceFingerprint(source))
      ? stored
      : undefined
  }
