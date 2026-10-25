import { type PlayableSource, resolutionOf, type Resolution } from '../catalog/catalog.ts'

/**
 * §7.7 versions and parts of a movie or an episode. Every ready source of the item is a version,
 * except the parts of a stack (`stack_group_id`), which together form one version, ordered by
 * `part_index`.
 */
export type PlaybackVersion = {
  /** `stack_group_id`, or the id of the single source. */
  key: string
  /** At least one; the parts of a stack in order. */
  parts: [PlayableSource, ...PlayableSource[]]
}

const byPartIndex = (a: PlayableSource, b: PlayableSource): number =>
  (a.partIndex ?? 0) - (b.partIndex ?? 0)

/** Groups the ready sources of an item into versions, in the order of their first source. */
export const groupVersions = (sources: readonly PlayableSource[]): PlaybackVersion[] => {
  const groups = new Map<string, PlayableSource[]>()
  for (const source of sources) {
    const key = source.stackGroupId ?? source.id
    groups.set(key, [...(groups.get(key) ?? []), source])
  }
  return [...groups].flatMap(([key, parts]) => {
    const [first, ...rest] = [...parts].sort(byPartIndex)
    return first === undefined ? [] : [{ key, parts: [first, ...rest] }]
  })
}

/** The version a source (any of its parts) belongs to. */
export const versionOf = (
  versions: readonly PlaybackVersion[],
  sourceId: string,
): PlaybackVersion | undefined =>
  versions.find((version) => version.parts.some((part) => part.id === sourceId))

const resolutionRank: Record<Resolution, number> = { SD: 0, '720p': 1, '1080p': 2, '2160p': 3 }
const rangeRank = { sdr: 0, hdr: 1, dv: 2 } as const

const qualityKey = (version: PlaybackVersion): [number, number, number] => {
  const video = version.parts[0].media?.video[0]
  const resolution = video === undefined ? undefined : resolutionOf(video.width, video.height)
  return [
    resolution === undefined ? -1 : resolutionRank[resolution],
    rangeRank[video?.dynamicRange ?? 'sdr'],
    version.parts.reduce((total, part) => total + part.sizeBytes, 0),
  ]
}

/**
 * Best first: resolution, then dynamic range, then total size. A version whose stored probe is
 * unknown comes last. Stable for equal keys.
 */
export const rankVersions = (versions: readonly PlaybackVersion[]): PlaybackVersion[] =>
  versions
    .map((version, order) => ({ version, order, key: qualityKey(version) }))
    .sort((a, b) => {
      for (let i = 0; i < 3; i += 1) {
        const diff = (b.key[i] ?? 0) - (a.key[i] ?? 0)
        if (diff !== 0) return diff
      }
      return a.order - b.order
    })
    .map(({ version }) => version)

/** A part on the item timeline (§8.4: positions and durations are cumulative over the parts). */
export type TimelinePart = { sourceId: string; index: number; offsetMs: number; durationMs: number }

export const partsTimeline = (
  parts: readonly { sourceId: string; durationMs: number }[],
): TimelinePart[] => {
  let offsetMs = 0
  return parts.map(({ sourceId, durationMs }, index) => {
    const part = { sourceId, index, offsetMs, durationMs }
    offsetMs += durationMs
    return part
  })
}

export const totalDurationMs = (timeline: readonly TimelinePart[]): number =>
  timeline.reduce((total, part) => total + part.durationMs, 0)

/**
 * The part that contains an item position: `offset ≤ position < offset + duration`; past the end,
 * the last part.
 */
export const partAt = (timeline: readonly TimelinePart[], positionMs: number): TimelinePart => {
  const found = timeline.find(
    (part) => positionMs >= part.offsetMs && positionMs < part.offsetMs + part.durationMs,
  )
  const last = timeline[timeline.length - 1]
  if (found !== undefined) return found
  if (last === undefined) throw new Error('a version has at least one part')
  return last
}
