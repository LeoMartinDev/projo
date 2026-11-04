import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

export type BitmapCue = {
  startS: number
  endS: number
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
  0x50,
  0x47,
  ...u32(Math.round(ptsS * 90_000)),
  ...u32(0),
  type,
  ...u16(data.length),
  ...data,
]

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
    0x10,
    ...u16(n),
    0x80,
    0x00,
    0x00,
    0x01,
    ...u16(0),
    0x00,
    0x00,
    ...u16(cue.x),
    ...u16(cue.y),
  ]
  const wds = [0x01, 0x00, ...u16(cue.x), ...u16(cue.y), ...u16(cue.width), ...u16(cue.height)]
  const pds = [0x00, 0x00, 0x01, 235, 128, 128, 0xff]
  const bitmap = rle(cue.width, cue.height)
  const objectLength = bitmap.length + 4
  const ods = [
    ...u16(0),
    0x00,
    0xc0,
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
    0x00,
    0x00,
    0x00,
    0x00,
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
