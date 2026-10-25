import { open } from 'node:fs/promises'

import { toHostPath } from '../fs/host-paths.ts'

/** `length` bytes of the file from `position` (fewer at its end). */
export type ReadAt = (position: number, length: number) => Promise<Uint8Array>

const ids = {
  ebml: 0x1a45dfa3,
  segment: 0x18538067,
  seekHead: 0x114d9b74,
  seek: 0x4dbb,
  seekId: 0x53ab,
  seekPosition: 0x53ac,
  info: 0x1549a966,
  timecodeScale: 0x2ad7b1,
  tracks: 0x1654ae6b,
  trackEntry: 0xae,
  trackNumber: 0xd7,
  trackType: 0x83,
  cues: 0x1c53bb6b,
  cuePoint: 0xbb,
  cueTime: 0xb3,
  cueTrackPositions: 0xb7,
  cueTrack: 0xf7,
  cueClusterPosition: 0xf1,
  cluster: 0x1f43b675,
  clusterTimecode: 0xe7,
  simpleBlock: 0xa3,
  blockGroup: 0xa0,
  block: 0xa1,
  referenceBlock: 0xfb,
} as const

const videoTrackType = 1
const keyframeFlag = 0x80
/** Longest header of an element: 4-byte id, 8-byte size. */
const maxHeaderBytes = 12
/** Top-level elements looked at before the first cluster. */
const maxTopLevelElements = 32
const maxMetadataBytes = 16 * 1024 * 1024
/** Bytes read per checked stretch of clusters; a longer stretch is not checked. */
const maxCheckedBytes = 48 * 1024 * 1024
/** Where the cues are checked against the clusters, as a fraction of the cue points. */
const checkedStretches = [0.25, 0.5, 0.75]

type Element = { id: number; dataStart: number; end: number }
type CuePoint = { ticks: number; clusterPosition: number }

/** Length of an EBML variable-size integer from its first byte, `undefined` if invalid. */
const vintLength = (first: number | undefined): number | undefined =>
  first === undefined || first === 0 ? undefined : Math.clz32(first) - 23

const readUint = (bytes: Uint8Array) => bytes.reduce((value, byte) => value * 256 + byte, 0)

/** Value of the `length`-byte variable-size integer at the start of `bytes` (marker removed). */
const readVint = (bytes: Uint8Array, length: number) =>
  readUint(bytes.subarray(1, length)) + ((bytes[0] ?? 0) & (0xff >> length)) * 256 ** (length - 1)

/**
 * The element whose header starts at `offset` of `bytes` (`bytes[0]` is at file position `base`).
 * `undefined` when the header is truncated or the size unknown (live streams).
 */
const elementAt = (bytes: Uint8Array, offset: number, base: number): Element | undefined => {
  const idLength = vintLength(bytes[offset])
  if (idLength === undefined || idLength > 4) return undefined
  const sizeOffset = offset + idLength
  const sizeLength = vintLength(bytes[sizeOffset])
  if (sizeLength === undefined || sizeOffset + sizeLength > bytes.length) return undefined
  const sizeBytes = bytes.subarray(sizeOffset, sizeOffset + sizeLength)
  const size = readVint(sizeBytes, sizeLength)
  if (size === 2 ** (7 * sizeLength) - 1) return undefined
  const dataStart = base + sizeOffset + sizeLength
  return { id: readUint(bytes.subarray(offset, sizeOffset)), dataStart, end: dataStart + size }
}

/** The elements laid one after the other in `bytes`; stops at the first that does not fit. */
const childrenOf = (bytes: Uint8Array, base: number): Element[] => {
  const elements: Element[] = []
  let offset = 0
  while (offset < bytes.length) {
    const element = elementAt(bytes, offset, base)
    if (element === undefined || element.end - base > bytes.length) break
    elements.push(element)
    offset = element.end - base
  }
  return elements
}

const dataOf = (bytes: Uint8Array, element: Element, base: number) =>
  bytes.subarray(element.dataStart - base, element.end - base)

/** The element at `position` and its data; `undefined` when longer than `maxBytes`. */
const loadElement = async (readAt: ReadAt, position: number, maxBytes: number) => {
  const element = elementAt(await readAt(position, maxHeaderBytes), 0, position)
  if (element === undefined || element.end - element.dataStart > maxBytes) return undefined
  const data = await readAt(element.dataStart, element.end - element.dataStart)
  return data.length === element.end - element.dataStart ? { element, data } : undefined
}

/** Track number, timecode relative to its cluster and flags of a `SimpleBlock` or `Block`. */
const blockHeader = (block: Uint8Array) => {
  const length = vintLength(block[0])
  if (length === undefined || block.length < length + 3) return undefined
  const relative = ((block[length] ?? 0) << 8) | (block[length + 1] ?? 0)
  return {
    track: readVint(block, length),
    relative: relative >= 0x8000 ? relative - 0x10000 : relative,
    flags: block[length + 2] ?? 0,
  }
}

/** Times (ticks) of the keyframes of `track` in a stretch of whole clusters. */
const clusterKeyframes = (bytes: Uint8Array, base: number, track: number): number[] => {
  const keyframes: number[] = []
  for (const cluster of childrenOf(bytes, base)) {
    if (cluster.id !== ids.cluster) continue
    const body = dataOf(bytes, cluster, base)
    let timecode = 0
    for (const child of childrenOf(body, cluster.dataStart)) {
      const data = dataOf(body, child, cluster.dataStart)
      if (child.id === ids.clusterTimecode) timecode = readUint(data)
      if (child.id === ids.simpleBlock) {
        const block = blockHeader(data)
        if (block?.track === track && (block.flags & keyframeFlag) !== 0) {
          keyframes.push(timecode + block.relative)
        }
      }
      if (child.id === ids.blockGroup) {
        // A `Block` is a keyframe when it references no other block.
        const parts = childrenOf(data, child.dataStart)
        const inner = parts.find((part) => part.id === ids.block)
        if (inner === undefined || parts.some((part) => part.id === ids.referenceBlock)) continue
        const block = blockHeader(dataOf(data, inner, child.dataStart))
        if (block?.track === track) keyframes.push(timecode + block.relative)
      }
    }
  }
  return keyframes
}

/** Positions of the top-level elements of the segment, from its `SeekHead` and its start. */
const topLevelPositions = async (readAt: ReadAt, segmentStart: number) => {
  const positions = new Map<number, number>()
  let cursor = segmentStart
  for (let count = 0; count < maxTopLevelElements; count += 1) {
    const element = elementAt(await readAt(cursor, maxHeaderBytes), 0, cursor)
    if (element === undefined || element.id === ids.cluster) break
    if (!positions.has(element.id)) positions.set(element.id, cursor)
    if (element.id === ids.seekHead) {
      const seekHead = await loadElement(readAt, cursor, maxMetadataBytes)
      if (seekHead === undefined) break
      for (const seek of childrenOf(seekHead.data, seekHead.element.dataStart)) {
        if (seek.id !== ids.seek) continue
        const fields = childrenOf(
          dataOf(seekHead.data, seek, seekHead.element.dataStart),
          seek.dataStart,
        )
        const field = (id: number) => {
          const found = fields.find((candidate) => candidate.id === id)
          return found === undefined
            ? undefined
            : readUint(
                seekHead.data.subarray(
                  found.dataStart - seekHead.element.dataStart,
                  found.end - seekHead.element.dataStart,
                ),
              )
        }
        const id = field(ids.seekId)
        const position = field(ids.seekPosition)
        if (id !== undefined && position !== undefined && !positions.has(id)) {
          positions.set(id, segmentStart + position)
        }
      }
    }
    cursor = element.end
  }
  return positions
}

/**
 * The cue points of the only video track, read from the Matroska `Cues` (§10.3), with the timecode
 * scale (ns per tick). `undefined` when the file is not Matroska, has several video tracks, or no
 * usable cues.
 */
const readCues = async (readAt: ReadAt) => {
  const ebml = elementAt(await readAt(0, maxHeaderBytes), 0, 0)
  if (ebml?.id !== ids.ebml) return undefined
  const segment = elementAt(await readAt(ebml.end, maxHeaderBytes), 0, ebml.end)
  if (segment?.id !== ids.segment) return undefined
  const positions = await topLevelPositions(readAt, segment.dataStart)
  const load = async (id: number) => {
    const position = positions.get(id)
    return position === undefined ? undefined : loadElement(readAt, position, maxMetadataBytes)
  }
  const fieldsOf = (loaded: { element: Element; data: Uint8Array }, parent: Element) =>
    childrenOf(dataOf(loaded.data, parent, loaded.element.dataStart), parent.dataStart).map(
      (child) => ({
        id: child.id,
        element: child,
        value: () => readUint(dataOf(loaded.data, child, loaded.element.dataStart)),
      }),
    )

  const info = await load(ids.info)
  const tracks = await load(ids.tracks)
  const cues = await load(ids.cues)
  if (info === undefined || tracks === undefined || cues === undefined) return undefined

  const scale =
    fieldsOf(info, info.element)
      .find((field) => field.id === ids.timecodeScale)
      ?.value() ?? 1_000_000

  const videoTracks = fieldsOf(tracks, tracks.element)
    .filter((entry) => entry.id === ids.trackEntry)
    .map((entry) => fieldsOf(tracks, entry.element))
    .filter(
      (fields) => fields.find((field) => field.id === ids.trackType)?.value() === videoTrackType,
    )
    .map((fields) => fields.find((field) => field.id === ids.trackNumber)?.value())
  const [track] = videoTracks
  if (videoTracks.length !== 1 || track === undefined) return undefined

  const points: CuePoint[] = []
  for (const point of fieldsOf(cues, cues.element)) {
    if (point.id !== ids.cuePoint) continue
    const fields = fieldsOf(cues, point.element)
    const ticks = fields.find((field) => field.id === ids.cueTime)?.value()
    for (const positionsField of fields.filter((field) => field.id === ids.cueTrackPositions)) {
      const trackFields = fieldsOf(cues, positionsField.element)
      const cluster = trackFields.find((field) => field.id === ids.cueClusterPosition)?.value()
      if (
        ticks !== undefined &&
        cluster !== undefined &&
        trackFields.find((field) => field.id === ids.cueTrack)?.value() === track
      ) {
        points.push({ ticks, clusterPosition: segment.dataStart + cluster })
      }
    }
  }
  points.sort((a, b) => a.ticks - b.ticks)
  return points.length < 2 ? undefined : { track, scale, points }
}

/**
 * Does the stretch of clusters between two cue points hold a video keyframe the cues miss? Reads
 * from the cluster of `points[index]` to the end of the one holding `points[index + 1]`.
 * `undefined` when that stretch is too long to check.
 */
const missesKeyframes = async (
  readAt: ReadAt,
  track: number,
  points: readonly CuePoint[],
  index: number,
): Promise<boolean | undefined> => {
  const from = points[index]
  const to = points[index + 1]
  if (from === undefined || to === undefined) return undefined
  const last = elementAt(await readAt(to.clusterPosition, maxHeaderBytes), 0, to.clusterPosition)
  if (last?.id !== ids.cluster) return true
  const length = last.end - from.clusterPosition
  if (length <= 0 || length > maxCheckedBytes) return undefined
  const bytes = await readAt(from.clusterPosition, length)
  return clusterKeyframes(bytes, from.clusterPosition, track).some(
    (ticks) => ticks > from.ticks && ticks < to.ticks,
  )
}

/**
 * Video keyframe times (seconds from the file's time zero) from the Matroska cues, without reading
 * the whole file (§10.3): a few hundred kilobytes against the full packet scan of ffprobe, which
 * reads every byte (minutes on a network share). Only when they list every keyframe: three
 * stretches of clusters are checked block by block, and a cue missing from any of them, or no
 * stretch short enough to check, gives `undefined` (full scan instead).
 */
export const matroskaKeyframes = async (readAt: ReadAt): Promise<number[] | undefined> => {
  const cues = await readCues(readAt)
  if (cues === undefined) return undefined
  const { track, scale, points } = cues
  const stretches = [...new Set(checkedStretches.map((at) => Math.floor(at * (points.length - 1))))]
  let checked = 0
  for (const index of stretches) {
    const missing = await missesKeyframes(readAt, track, points, index)
    if (missing === true) return undefined
    if (missing === false) checked += 1
  }
  if (checked === 0) return undefined
  return [...new Set(points.map((point) => (point.ticks * scale) / 1e9))]
}

/** `matroskaKeyframes` of a file; `undefined` on any read error too. */
export const matroskaKeyframesOf = async (path: string): Promise<number[] | undefined> => {
  try {
    const file = await open(toHostPath(path), 'r')
    try {
      return await matroskaKeyframes(async (position, length) => {
        const buffer = new Uint8Array(length)
        const { bytesRead } = await file.read(buffer, 0, length, position)
        return buffer.subarray(0, bytesRead)
      })
    } finally {
      await file.close()
    }
  } catch {
    return undefined
  }
}
