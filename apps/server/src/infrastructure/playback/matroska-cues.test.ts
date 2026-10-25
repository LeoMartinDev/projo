import { expect, test } from 'bun:test'

import { matroskaKeyframes, type ReadAt } from './matroska-cues.ts'

// A tiny Matroska writer: every size on 8 bytes, every uint on 4.
const concat = (parts: readonly Uint8Array[]) => {
  const bytes = new Uint8Array(parts.reduce((total, part) => total + part.length, 0))
  let offset = 0
  for (const part of parts) {
    bytes.set(part, offset)
    offset += part.length
  }
  return bytes
}
const idBytes = (id: number) => {
  const bytes: number[] = []
  for (let rest = id; rest > 0; rest = Math.floor(rest / 256)) bytes.unshift(rest % 256)
  return Uint8Array.from(bytes)
}
const sizeBytes = (size: number) => {
  const bytes = new Uint8Array(8)
  bytes[0] = 0x01
  for (let i = 7, rest = size; i > 0; i -= 1, rest = Math.floor(rest / 256)) bytes[i] = rest % 256
  return bytes
}
const el = (id: number, ...children: Uint8Array[]) => {
  const data = concat(children)
  return concat([idBytes(id), sizeBytes(data.length), data])
}
const uint = (id: number, value: number) =>
  el(id, Uint8Array.of(value >>> 24, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff))

const blockData = (track: number, relative: number, flags: number) =>
  Uint8Array.of(0x80 | track, (relative >> 8) & 0xff, relative & 0xff, flags, 0xaa)
const simpleBlock = (track: number, relative: number, keyframe: boolean) =>
  el(0xa3, blockData(track, relative, keyframe ? 0x80 : 0))
/** A keyframe in a `BlockGroup`: a `Block` without `ReferenceBlock`. */
const groupedKeyframe = (track: number, relative: number) =>
  el(0xa0, el(0xa1, blockData(track, relative, 0)))

type Spec = {
  /** Cluster start times (ticks): a video keyframe at each, then non-key frames. */
  clusters: number[]
  /** Clusters (indexes) listed in the cues; all by default. */
  cued?: number[]
  /** Clusters whose keyframe is a `BlockGroup`. */
  grouped?: number[]
  videoTracks?: number
  timecodeScale?: number
}

const matroska = ({
  clusters,
  cued = clusters.map((_, index) => index),
  grouped = [],
  videoTracks = 1,
  timecodeScale = 1_000_000,
}: Spec): Uint8Array => {
  const info = el(0x1549a966, uint(0x2ad7b1, timecodeScale))
  const tracks = el(
    0x1654ae6b,
    ...Array.from({ length: videoTracks }, (_, index) =>
      el(0xae, uint(0xd7, index + 1), uint(0x83, 1)),
    ),
    el(0xae, uint(0xd7, 9), uint(0x83, 2)),
  )
  const clusterBytes = clusters.map((start, index) =>
    el(
      0x1f43b675,
      uint(0xe7, start),
      grouped.includes(index) ? groupedKeyframe(1, 0) : simpleBlock(1, 0, true),
      simpleBlock(9, 0, true),
      simpleBlock(1, 500, false),
      simpleBlock(1, 1000, false),
    ),
  )
  const seekHead = (cuesAt: number) =>
    el(0x114d9b74, el(0x4dbb, el(0x53ab, idBytes(0x1c53bb6b)), uint(0x53ac, cuesAt)))
  const beforeClusters = seekHead(0).length + info.length + tracks.length
  const clusterAt = (index: number) =>
    beforeClusters + clusterBytes.slice(0, index).reduce((total, bytes) => total + bytes.length, 0)
  const cues = el(
    0x1c53bb6b,
    ...cued.map((index) =>
      el(
        0xbb,
        uint(0xb3, clusters[index] ?? 0),
        el(0xb7, uint(0xf7, 1), uint(0xf1, clusterAt(index))),
      ),
    ),
  )
  const segment = el(
    0x18538067,
    seekHead(clusterAt(clusters.length)),
    info,
    tracks,
    ...clusterBytes,
    cues,
  )
  return concat([el(0x1a45dfa3, el(0x4282, new TextEncoder().encode('matroska'))), segment])
}

const reader =
  (bytes: Uint8Array): ReadAt =>
  async (position, length) =>
    bytes.subarray(position, position + length)

const everyTwoSeconds = Array.from({ length: 8 }, (_, index) => index * 2000)

test('cues listing every keyframe give the index, in seconds', async () => {
  expect(await matroskaKeyframes(reader(matroska({ clusters: everyTwoSeconds })))).toEqual([
    0, 2, 4, 6, 8, 10, 12, 14,
  ])
})

test('the timecode scale converts ticks to seconds', async () => {
  const bytes = matroska({ clusters: [0, 4000, 8000], timecodeScale: 500_000 })
  expect(await matroskaKeyframes(reader(bytes))).toEqual([0, 2, 4])
})

test('cues missing keyframes are not trusted: the full scan is needed', async () => {
  const sparse = matroska({ clusters: everyTwoSeconds, cued: [0, 2, 4, 6] })
  expect(await matroskaKeyframes(reader(sparse))).toBeUndefined()
})

test('a keyframe stored in a BlockGroup counts too', async () => {
  const bytes = matroska({ clusters: everyTwoSeconds, cued: [0, 1, 2, 3, 5, 6, 7], grouped: [4] })
  expect(await matroskaKeyframes(reader(bytes))).toBeUndefined()
})

test('not Matroska, several video tracks or no cues: undefined', async () => {
  expect(await matroskaKeyframes(reader(new Uint8Array(64)))).toBeUndefined()
  expect(
    await matroskaKeyframes(reader(matroska({ clusters: everyTwoSeconds, videoTracks: 2 }))),
  ).toBeUndefined()
  expect(
    await matroskaKeyframes(reader(matroska({ clusters: everyTwoSeconds, cued: [] }))),
  ).toBeUndefined()
})
