import type { PlayableSources, VisibilityScopeResolver } from '../../core/catalog/catalog.ts'
import {
  sameFingerprint,
  trickplayInstantAt,
  type TrickplayStore,
} from '../../core/playback/media-assets.ts'
import { groupVersions, partAt, partsTimeline, rankVersions } from '../../core/playback/versions.ts'
import { sourceFingerprint } from './shared/source-fingerprint.ts'

export type ResumeFrame = { sourceId: string; second: number }

export const resumeFramesFactory =
  ({
    playableSources,
    trickplayStore,
    scopeFor,
  }: {
    playableSources: Pick<PlayableSources, 'listReadySources'>
    trickplayStore: TrickplayStore
    scopeFor: VisibilityScopeResolver
  }) =>
  ({
    itemId,
    positionMs,
    profileId,
  }: {
    itemId: string
    positionMs: number
    profileId: string
  }): ResumeFrame | undefined => {
    const sources = playableSources.listReadySources({ itemId, scope: scopeFor(profileId) })
    for (const version of rankVersions(groupVersions(sources))) {
      const timeline = partsTimeline(
        version.parts.map((part) => ({
          sourceId: part.id,
          durationMs: part.media?.durationMs ?? 0,
        })),
      )
      if (version.parts.length > 1 && timeline.some((part) => part.durationMs <= 0)) continue
      const part = partAt(timeline, positionMs)
      const source = version.parts[part.index]
      const stored = source === undefined ? undefined : trickplayStore.read(source.id)
      if (
        source === undefined ||
        stored === undefined ||
        !sameFingerprint(stored.fingerprint, sourceFingerprint(source))
      ) {
        continue
      }
      const second = trickplayInstantAt(
        stored.index,
        (positionMs - part.offsetMs) / 1000,
        (source.media?.durationMs ?? 0) / 1000,
      )
      if (second !== undefined) return { sourceId: source.id, second }
    }
    return undefined
  }

export type ResumeFrames = ReturnType<typeof resumeFramesFactory>
