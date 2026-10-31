import { children } from '../../src/infrastructure/playback/fmp4.ts'

/**
 * Test-only reading of fragmented MP4 boxes: the remuxer only needs `fragmentStartTicks`, the
 * HLS tests check the whole timeline a player builds from every sample.
 */

const view = (bytes: Uint8Array) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)

const child = (box: Uint8Array, type: string): Uint8Array | undefined =>
  children(box).find((entry) => entry.type === type)?.bytes

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
