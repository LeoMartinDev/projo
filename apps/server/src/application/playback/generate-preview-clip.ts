import { ok, type Result } from '@projo/shared'

import {
  type CatalogReadModel,
  everything,
  type PlayableSource,
  type PlayableSources,
} from '../../core/catalog/catalog.ts'
import type { Logger } from '../../core/logger.ts'
import type { MediaError } from '../../core/media/probe.ts'
import {
  type MediaAssetCatalog,
  previewWindow,
  type PreviewStore,
  sameFingerprint,
} from '../../core/playback/media-assets.ts'
import { sourceFingerprint } from './shared/source-fingerprint.ts'

type ClipSource = { source: PlayableSource; durationMs: number }

const playable = (source: PlayableSource | undefined): ClipSource | undefined => {
  const durationMs = source?.media?.durationMs
  if (
    source === undefined ||
    !source.rootReachable ||
    source.media?.video[0] === undefined ||
    durationMs === undefined ||
    durationMs <= 0
  ) {
    return undefined
  }
  return { source, durationMs }
}

type ClipSourceDeps = {
  catalogReadModel: Pick<CatalogReadModel, 'listSeriesEpisodes'>
  playableSources: Pick<PlayableSources, 'listReadySources'>
}

const clipSourceFactory =
  ({ catalogReadModel, playableSources }: ClipSourceDeps) =>
  (target: { id: string; kind: 'movie' | 'series' }): ClipSource | undefined => {
    if (target.kind === 'movie') {
      return playable(playableSources.listReadySources({ itemId: target.id, scope: everything })[0])
    }
    const episodes = catalogReadModel.listSeriesEpisodes({
      seriesIds: [target.id],
      scope: everything,
    })
    for (const episode of episodes.toReversed()) {
      const found = playable(
        playableSources.listReadySources({ itemId: episode.id, scope: everything })[0],
      )
      if (found !== undefined) return found
    }
    return undefined
  }

export const generatePreviewClipFactory = ({
  catalogReadModel,
  playableSources,
  mediaCatalog,
  previewStore,
  logger,
}: ClipSourceDeps & {
  mediaCatalog: MediaAssetCatalog
  previewStore: PreviewStore
  logger: Logger
}) => {
  const clipSource = clipSourceFactory({ catalogReadModel, playableSources })
  return async ({
    itemId,
    signal,
  }: {
    itemId: string
    signal?: AbortSignal
  }): Promise<Result<'generated' | 'skipped', MediaError>> => {
    const target = mediaCatalog.previewTargetOf(itemId)
    if (target === undefined) return ok('skipped')
    const found = clipSource(target)
    if (found === undefined) return ok('skipped')
    const { source, durationMs } = found
    const fingerprint = sourceFingerprint(source)
    const stored = previewStore.read(target.id)
    if (
      stored !== undefined &&
      stored.sourceId === source.id &&
      sameFingerprint(stored.fingerprint, fingerprint)
    ) {
      return ok('skipped')
    }
    const media = source.media
    const video = media?.video[0]
    if (media === undefined || video === undefined) return ok('skipped')
    const audio = media.audio.find((track) => track.isDefault) ?? media.audio[0]
    const generated = await previewStore.generate({
      itemId: target.id,
      sourceId: source.id,
      path: source.path,
      videoStreamIndex: video.index,
      ...(audio === undefined ? {} : { audioStreamIndex: audio.index }),
      ...previewWindow(durationMs),
      fingerprint,
      ...(signal === undefined ? {} : { signal }),
    })
    if (!generated.ok) return generated
    logger.info('preview clip generated', { itemId: target.id, sourceId: source.id })
    return ok('generated')
  }
}

export type GeneratePreviewClip = ReturnType<typeof generatePreviewClipFactory>
