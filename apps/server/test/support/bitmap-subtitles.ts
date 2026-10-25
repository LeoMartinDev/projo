import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Hand-written PGS (`.sup`, HDMV Presentation Graphic Stream) files: ffmpeg decodes bitmap
 * subtitles but cannot create them from text, so burn-in tests (§10.4) build the stream here.
 * Each cue shows one opaque white rectangle; a test reads the luma of that area to know whether
 * the subtitle was burnt in at a given time.
 */

export type BitmapCue = {
  startS: number
  endS: number
  /** Rectangle on the canvas, pixels. */
  x: number
  y: number
  width: number
  height: number
}

const u16 = (value: number): number[] => [(value >> 8) & 0xff, value & 0xff]
const u32 = (value: number): number[] => [
  (value >>> 24) & 0xff,
  (value >>> 16) & 0xff,
  (value >>> 8) & 0xff,
  value & 0xff,
]

const segment = (ptsS: number, type: number, data: number[]): number[] => [
  0x50, // 'P'
  0x47, // 'G'
  ...u32(Math.round(ptsS * 90_000)),
  ...u32(0),
  type,
  ...u16(data.length),
  ...data,
]

/** PGS run-length encoding of a rectangle filled with palette entry 1. */
const rle = (width: number, height: number): number[] => {
  const line =
    width < 64 ? [0x00, 0x80 | width, 0x01] : [0x00, 0xc0 | (width >> 8), width & 0xff, 0x01]
  return Array.from({ length: height }, () => [...line, 0x00, 0x00]).flat()
}

const showCue = (
  cue: BitmapCue,
  canvas: { width: number; height: number },
  n: number,
): number[] => {
  const pcs = [
    ...u16(canvas.width),
    ...u16(canvas.height),
    0x10, // frame rate (ignored)
    ...u16(n),
    0x80, // epoch start
    0x00, // no palette-only update
    0x00, // palette id
    0x01, // one composition object
    ...u16(0), // object id
    0x00, // window id
    0x00, // not cropped
    ...u16(cue.x),
    ...u16(cue.y),
  ]
  const wds = [0x01, 0x00, ...u16(cue.x), ...u16(cue.y), ...u16(cue.width), ...u16(cue.height)]
  // Entry 1: Y=235 (white), Cr=Cb=128, opaque.
  const pds = [0x00, 0x00, 0x01, 235, 128, 128, 0xff]
  const bitmap = rle(cue.width, cue.height)
  const objectLength = bitmap.length + 4
  const ods = [
    ...u16(0), // object id
    0x00, // version
    0xc0, // first and last fragment
    (objectLength >> 16) & 0xff,
    (objectLength >> 8) & 0xff,
    objectLength & 0xff,
    ...u16(cue.width),
    ...u16(cue.height),
    ...bitmap,
  ]
  return [
    ...segment(cue.startS, 0x16, pcs),
    ...segment(cue.startS, 0x17, wds),
    ...segment(cue.startS, 0x14, pds),
    ...segment(cue.startS, 0x15, ods),
    ...segment(cue.startS, 0x80, []),
  ]
}

const clearCue = (
  cue: BitmapCue,
  canvas: { width: number; height: number },
  n: number,
): number[] => [
  ...segment(cue.endS, 0x16, [
    ...u16(canvas.width),
    ...u16(canvas.height),
    0x10,
    ...u16(n),
    0x00, // normal
    0x00,
    0x00,
    0x00, // no object: clears the screen
  ]),
  ...segment(cue.endS, 0x17, [
    0x01,
    0x00,
    ...u16(cue.x),
    ...u16(cue.y),
    ...u16(cue.width),
    ...u16(cue.height),
  ]),
  ...segment(cue.endS, 0x80, []),
]

/** Writes `<dir>/<name>` (a `.sup`) with the cues, in order. */
export const writePgs = (
  dir: string,
  name: string,
  canvas: { width: number; height: number },
  cues: readonly BitmapCue[],
): string => {
  const bytes = cues.flatMap((cue, i) => [
    ...showCue(cue, canvas, 2 * i),
    ...clearCue(cue, canvas, 2 * i + 1),
  ])
  const path = join(dir, name)
  writeFileSync(path, new Uint8Array(bytes))
  return path
}
