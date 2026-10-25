/**
 * Minimal ISO BMFF reading for the remuxer: split ffmpeg's fragmented MP4 stream into top-level
 * boxes, read track timescales from `moov`, the start time of a `moof`, and renumber `mfhd`.
 */

export type Mp4Box = { type: string; bytes: Uint8Array }

const typeAt = (bytes: Uint8Array, offset: number): string =>
  String.fromCharCode(
    bytes[offset] ?? 0,
    bytes[offset + 1] ?? 0,
    bytes[offset + 2] ?? 0,
    bytes[offset + 3] ?? 0,
  )

const view = (bytes: Uint8Array) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)

/** Size and header length of the box at `offset`; undefined while the header is incomplete. */
const boxHeader = (
  bytes: Uint8Array,
  offset: number,
  end: number,
): { size: number; header: number } | undefined => {
  if (end - offset < 8) return undefined
  const data = view(bytes)
  const size32 = data.getUint32(offset)
  if (size32 === 1) {
    if (end - offset < 16) return undefined
    return { size: Number(data.getBigUint64(offset + 8)), header: 16 }
  }
  // size 0 ("to the end of the file") is never produced for fragments: rejected as < 8.
  return { size: size32, header: 8 }
}

/**
 * Incremental splitter of a byte stream into complete top-level boxes. Chunks are queued and
 * copied once, when a whole box is available (an `mdat` can weigh megabytes).
 */
export const createBoxSplitter = () => {
  const queue: Uint8Array[] = []
  let queued = 0

  /** Removes and returns the first `length` bytes of the queue (`peek` keeps them). */
  const take = (length: number, peek = false): Uint8Array => {
    const out = new Uint8Array(length)
    let filled = 0
    let index = 0
    while (filled < length) {
      const chunk = queue[index] as Uint8Array
      const part = Math.min(chunk.length, length - filled)
      out.set(chunk.subarray(0, part), filled)
      filled += part
      if (peek) {
        index += 1
      } else if (part === chunk.length) {
        queue.shift()
      } else {
        queue[0] = chunk.subarray(part)
      }
    }
    if (!peek) queued -= length
    return out
  }

  return {
    push: (chunk: Uint8Array): Mp4Box[] => {
      if (chunk.length > 0) {
        queue.push(chunk)
        queued += chunk.length
      }
      const boxes: Mp4Box[] = []
      for (;;) {
        if (queued < 8) break
        const head = take(Math.min(16, queued), true)
        const header = boxHeader(head, 0, head.length)
        if (header === undefined || queued < header.size) break
        if (header.size < 8) throw new Error(`invalid MP4 box size ${header.size}`)
        const bytes = take(header.size)
        boxes.push({ type: typeAt(bytes, 4), bytes })
      }
      return boxes
    },
  }
}

/** Child boxes of a container box (`moov`, `trak`, `moof`…). */
const children = (box: Uint8Array, headerLength = 8): Mp4Box[] => {
  const result: Mp4Box[] = []
  let offset = headerLength
  while (offset < box.length) {
    const header = boxHeader(box, offset, box.length)
    if (header === undefined || header.size < 8 || offset + header.size > box.length) break
    result.push({
      type: typeAt(box, offset + 4),
      bytes: box.subarray(offset, offset + header.size),
    })
    offset += header.size
  }
  return result
}

const child = (box: Uint8Array, type: string): Uint8Array | undefined =>
  children(box).find((entry) => entry.type === type)?.bytes

export type TrackInfo = { trackId: number; timescale: number; handler: string }

/** Tracks declared in `moov`: id (`tkhd`), timescale (`mdhd`), handler (`vide`, `soun`…). */
export const readTracks = (moov: Uint8Array): TrackInfo[] =>
  children(moov)
    .filter((entry) => entry.type === 'trak')
    .flatMap(({ bytes: trak }) => {
      const tkhd = child(trak, 'tkhd')
      const mdia = child(trak, 'mdia')
      const mdhd = mdia && child(mdia, 'mdhd')
      const hdlr = mdia && child(mdia, 'hdlr')
      if (tkhd === undefined || mdhd === undefined || hdlr === undefined) return []
      const tk = view(tkhd)
      const md = view(mdhd)
      const tkVersion = tkhd[8]
      const mdVersion = mdhd[8]
      return [
        {
          trackId: tk.getUint32(tkVersion === 1 ? 8 + 4 + 16 : 8 + 4 + 8),
          timescale: md.getUint32(mdVersion === 1 ? 8 + 4 + 16 : 8 + 4 + 8),
          handler: typeAt(hdlr, 8 + 4 + 4),
        },
      ]
    })

/**
 * Presentation time (in track timescale units) of the first sample of `trackId` in a `moof`:
 * `tfdt.baseMediaDecodeTime` plus the first sample's composition offset (`trun`).
 */
export const fragmentStartTicks = (moof: Uint8Array, trackId: number): number | undefined => {
  for (const { type, bytes: traf } of children(moof)) {
    if (type !== 'traf') continue
    const tfhd = child(traf, 'tfhd')
    if (tfhd === undefined || view(tfhd).getUint32(12) !== trackId) continue
    const tfdt = child(traf, 'tfdt')
    if (tfdt === undefined) return undefined
    const tfdtView = view(tfdt)
    const base = tfdt[8] === 1 ? Number(tfdtView.getBigUint64(12)) : tfdtView.getUint32(12)
    return base + firstCompositionOffset(child(traf, 'trun'))
  }
  return undefined
}

const firstCompositionOffset = (trun: Uint8Array | undefined): number => {
  if (trun === undefined) return 0
  const data = view(trun)
  const version = trun[8]
  const flags = data.getUint32(8) & 0xffffff
  if ((flags & 0x800) === 0 || data.getUint32(12) === 0) return 0
  let offset = 16
  if (flags & 0x1) offset += 4 // data_offset
  if (flags & 0x4) offset += 4 // first_sample_flags
  if (flags & 0x100) offset += 4 // sample_duration
  if (flags & 0x200) offset += 4 // sample_size
  if (flags & 0x400) offset += 4 // sample_flags
  return version === 1 ? data.getInt32(offset) : data.getUint32(offset)
}

/** Rewrites `mfhd.sequence_number` (in place): fragments get a number stable across ffmpeg runs. */
export const setSequenceNumber = (moof: Uint8Array, sequence: number): void => {
  const mfhd = child(moof, 'mfhd')
  if (mfhd !== undefined) view(mfhd).setUint32(12, sequence)
}

export type TrackRun = {
  /** `tfdt.baseMediaDecodeTime`, track timescale units. */
  baseDecodeTicks: number
  /** Per sample, in decode order: duration and composition offset (ticks). */
  samples: { durationTicks: number; compositionOffsetTicks: number }[]
}

/**
 * Samples of `trackId` in a `moof` (`tfhd` defaults, every `trun`): what a player places on its
 * timeline, presentation time = base + sum of previous durations + composition offset.
 */
export const readTrackRun = (moof: Uint8Array, trackId: number): TrackRun | undefined => {
  for (const { type, bytes: traf } of children(moof)) {
    if (type !== 'traf') continue
    const tfhd = child(traf, 'tfhd')
    if (tfhd === undefined || view(tfhd).getUint32(12) !== trackId) continue
    const tfhdView = view(tfhd)
    const tfhdFlags = tfhdView.getUint32(8) & 0xffffff
    let offset = 16
    if (tfhdFlags & 0x1) offset += 8 // base_data_offset
    if (tfhdFlags & 0x2) offset += 4 // sample_description_index
    const defaultDuration = tfhdFlags & 0x8 ? tfhdView.getUint32(offset) : 0
    const tfdt = child(traf, 'tfdt')
    const baseDecodeTicks =
      tfdt === undefined
        ? 0
        : tfdt[8] === 1
          ? Number(view(tfdt).getBigUint64(12))
          : view(tfdt).getUint32(12)
    const samples: TrackRun['samples'] = []
    for (const entry of children(traf)) {
      if (entry.type !== 'trun') continue
      const data = view(entry.bytes)
      const version = entry.bytes[8]
      const flags = data.getUint32(8) & 0xffffff
      const count = data.getUint32(12)
      let at = 16
      if (flags & 0x1) at += 4
      if (flags & 0x4) at += 4
      for (let i = 0; i < count; i += 1) {
        let durationTicks = defaultDuration
        let compositionOffsetTicks = 0
        if (flags & 0x100) {
          durationTicks = data.getUint32(at)
          at += 4
        }
        if (flags & 0x200) at += 4
        if (flags & 0x400) at += 4
        if (flags & 0x800) {
          compositionOffsetTicks = version === 1 ? data.getInt32(at) : data.getUint32(at)
          at += 4
        }
        samples.push({ durationTicks, compositionOffsetTicks })
      }
    }
    return { baseDecodeTicks, samples }
  }
  return undefined
}
