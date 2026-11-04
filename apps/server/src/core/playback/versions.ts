import { type PlayableSource, resolutionOf, type Resolution } from '../catalog/catalog.ts'

export type PlaybackVersion = {
  key: string
  parts: [PlayableSource, ...PlayableSource[]]
}

const byPartIndex = (a: PlayableSource, b: PlayableSource): number =>
  (a.partIndex ?? 0) - (b.partIndex ?? 0)

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

export const partAt = (timeline: readonly TimelinePart[], positionMs: number): TimelinePart => {
  const found = timeline.find(
    (part) => positionMs >= part.offsetMs && positionMs < part.offsetMs + part.durationMs,
  )
  const last = timeline[timeline.length - 1]
  if (found !== undefined) return found
  if (last === undefined) throw new Error('a version has at least one part')
  return last
}
