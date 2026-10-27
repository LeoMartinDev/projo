import type { CatalogRepository, VisibilityScopeResolver } from '../../core/catalog/catalog.ts'
import {
  sameFingerprint,
  trickplayInstantAt,
  type TrickplayStore,
} from '../../core/playback/media-assets.ts'
import { groupVersions, partAt, partsTimeline, rankVersions } from '../../core/playback/versions.ts'
import { sourceFingerprint } from './trickplay.ts'

/** A timeline thumbnail instant (§10.5) of a source, in seconds of that file. */
export type ResumeFrame = { sourceId: string; second: number }

/**
 * "Continue watching" cards (§13.3): the timeline thumbnail instant (§10.5) nearest to the
 * position the profile stopped at, from the best version that has up-to-date sprites (its still
 * is extracted when the card asks for it). Without sprites (still queued, disabled, source gone)
 * the answer is `undefined` and the card keeps its metadata image. Positions are on the item timeline, so a
 * stack of parts (§8.4) is walked to the part holding the position.
 */
export const resumeFramesFactory =
  ({
    catalogRepository,
    trickplayStore,
    scopeFor,
  }: {
    catalogRepository: Pick<CatalogRepository, 'listReadySources'>
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
    const sources = catalogRepository.listReadySources({ itemId, scope: scopeFor(profileId) })
    for (const version of rankVersions(groupVersions(sources))) {
      const timeline = partsTimeline(
        version.parts.map((part) => ({
          sourceId: part.id,
          durationMs: part.media?.durationMs ?? 0,
        })),
      )
      // Parts without a known duration cannot be placed on the item timeline.
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
