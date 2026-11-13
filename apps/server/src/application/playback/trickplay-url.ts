import type { PlayableSource, PlayableSources } from '../../core/catalog/catalog.ts'
import { sameFingerprint, type TrickplayStore } from '../../core/playback/media-assets.ts'
import { sourceFingerprint } from './shared/source-fingerprint.ts'

const isFresh = (store: TrickplayStore, source: PlayableSource): boolean => {
  const stored = store.read(source.id)
  return stored !== undefined && sameFingerprint(stored.fingerprint, sourceFingerprint(source))
}

export const trickplayUrlFactory =
  ({
    playableSources,
    trickplayStore,
  }: {
    playableSources: Pick<PlayableSources, 'findSource'>
    trickplayStore: TrickplayStore
  }) =>
  (sourceId: string): string | undefined => {
    const source = playableSources.findSource(sourceId)
    if (source === undefined || !isFresh(trickplayStore, source)) return undefined
    return `/api/v1/trickplay/${encodeURIComponent(sourceId)}/index.json?v=${source.mtime}`
  }

export type TrickplayUrl = ReturnType<typeof trickplayUrlFactory>
