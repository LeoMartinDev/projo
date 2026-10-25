import type { CatalogRepository, VisibilityScopeResolver } from '../../core/catalog/catalog.ts'
import {
  sameFingerprint,
  type TrickplayIndex,
  trickplayFrameAt,
  type TrickplayStore,
} from '../../core/playback/media-assets.ts'
import { groupVersions, partAt, partsTimeline, rankVersions } from '../../core/playback/versions.ts'
import { sourceFingerprint } from './trickplay.ts'

/** A timeline thumbnail (§10.5) of a source: its sheet, the cell in it and the sizes (pixels). */
export type ResumeFrame = {
  sourceId: string
  sheet: number
  x: number
  y: number
  width: number
  height: number
  sheetWidth: number
  sheetHeight: number
}

const frameOf = (
  sourceId: string,
  index: TrickplayIndex,
  seconds: number,
): ResumeFrame | undefined => {
  const frame = trickplayFrameAt(index, seconds)
  if (frame === undefined) return undefined
  return {
    sourceId,
    sheet: frame.sheet,
    x: frame.column * index.width,
    y: frame.row * index.height,
    width: index.width,
    height: index.height,
    sheetWidth: index.columns * index.width,
    sheetHeight: index.rows * index.height,
  }
}

/**
 * "Continue watching" cards (§13.3): the existing timeline thumbnail (§10.5) showing the
 * position the profile stopped at, from the best version that has up-to-date sprites. Nothing
 * is generated here: without sprites (still queued, disabled, source gone) the answer is
 * `undefined` and the card keeps its metadata image. Positions are on the item timeline, so a
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
      const frame = frameOf(source.id, stored.index, (positionMs - part.offsetMs) / 1000)
      if (frame !== undefined) return frame
    }
    return undefined
  }

export type ResumeFrames = ReturnType<typeof resumeFramesFactory>
