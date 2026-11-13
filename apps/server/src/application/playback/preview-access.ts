import { appError, type AppError, err, ok, type Result } from '@projo/shared'

import type {
  PlayableSources,
  VisibilityScopeResolver,
  VisibleItems,
} from '../../core/catalog/catalog.ts'
import { type PreviewStore, sameFingerprint } from '../../core/playback/media-assets.ts'
import type { SourceAccess } from './shared/source-access.ts'
import { sourceFingerprint } from './shared/source-fingerprint.ts'

export type PreviewAccessError = AppError<'playback/preview_not_found'>

export const previewAccessFactory =
  ({
    previewStore,
    visibleItems,
    playableSources,
    canAccessSource,
    scopeFor,
  }: {
    previewStore: PreviewStore
    visibleItems: Pick<VisibleItems, 'findVisible'>
    playableSources: Pick<PlayableSources, 'findSource'>
    canAccessSource: SourceAccess
    scopeFor: VisibilityScopeResolver
  }) =>
  ({
    itemId,
    profileId,
  }: {
    itemId: string
    profileId: string
  }): Result<string, PreviewAccessError> => {
    const visible =
      visibleItems.findVisible({ id: itemId, scope: scopeFor(profileId) }) !== undefined
    const stored = visible ? previewStore.read(itemId) : undefined
    const source = stored === undefined ? undefined : playableSources.findSource(stored.sourceId)
    if (
      stored === undefined ||
      source === undefined ||
      source.state !== 'ready' ||
      !sameFingerprint(stored.fingerprint, sourceFingerprint(source)) ||
      !canAccessSource({ sourceId: source.id, profileId })
    ) {
      return err(
        appError('playback/preview_not_found', 'no preview for this item', { context: { itemId } }),
      )
    }
    return ok(stored.path)
  }

export type PreviewAccess = ReturnType<typeof previewAccessFactory>
