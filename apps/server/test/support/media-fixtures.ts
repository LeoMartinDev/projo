import {
  closeSync,
  copyFileSync,
  mkdirSync,
  openSync,
  readFileSync,
  statSync,
  writeFileSync,
  writeSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

let cached: { mkv: string; mp4: string } | undefined

const run = (args: string[]): void => {
  const result = Bun.spawnSync(['ffmpeg', ...args], { stdout: 'ignore', stderr: 'pipe' })
  if (result.exitCode !== 0) {
    throw new Error(`ffmpeg failed: ${result.stderr.toString()}`)
  }
}

export const baseVideos = (): { mkv: string; mp4: string } => {
  if (cached !== undefined) return cached
  const dir = join(tmpdir(), `projo-media-fixtures-${process.pid}`)
  mkdirSync(dir, { recursive: true })
  const mkv = join(dir, 'base.mkv')
  const mp4 = join(dir, 'base.mp4')
  run([
    '-hide_banner',
    '-v',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    'testsrc=size=320x240:rate=25',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440',
    '-t',
    '3',
    '-vf',
    'noise=alls=40:allf=t',
    '-c:v',
    'mpeg4',
    '-q:v',
    '10',
    '-c:a',
    'aac',
    '-shortest',
    '-metadata:s:a:0',
    'language=fre',
    mkv,
  ])
  run(['-hide_banner', '-v', 'error', '-y', '-i', mkv, '-c', 'copy', mp4])
  cached = { mkv, mp4 }
  return cached
}

export const videoWithEmbeddedSubtitles = (): string => {
  const { mkv } = baseVideos()
  const srt = join(dirname(mkv), 'embedded.srt')
  writeFileSync(srt, '1\n00:00:00,500 --> 00:00:02,000\nHello\n')
  const out = join(dirname(mkv), 'with-subs.mkv')
  run([
    '-hide_banner',
    '-v',
    'error',
    '-y',
    '-i',
    mkv,
    '-i',
    srt,
    '-map',
    '0',
    '-map',
    '1',
    '-c',
    'copy',
    '-c:s',
    'srt',
    '-metadata:s:s:0',
    'language=eng',
    '-metadata:s:s:0',
    'title=English SDH',
    out,
  ])
  return out
}

export const placePartialVideo = (root: string, relativePath: string, fraction: number): string => {
  const target = join(root, relativePath)
  ensureParent(target)
  const content = readFileSync(baseVideos().mkv)
  writeFileSync(target, content.subarray(0, Math.floor(content.length * fraction)))
  return target
}

export const completeVideo = (path: string): void => {
  copyFileSync(baseVideos().mkv, path)
}

export const otherVideo = (): string => {
  const { mkv } = baseVideos()
  const other = join(dirname(mkv), 'other.mkv')
  run([
    '-hide_banner',
    '-v',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    'testsrc=size=320x240:rate=25',
    '-t',
    '4',
    '-vf',
    'noise=alls=40:allf=t',
    '-c:v',
    'mpeg4',
    '-q:v',
    '10',
    other,
  ])
  return other
}

const ensureParent = (path: string): void => {
  mkdirSync(dirname(path), { recursive: true })
}

export const placeVideo = (root: string, relativePath: string, from?: string): string => {
  const target = join(root, relativePath)
  ensureParent(target)
  const { mkv, mp4 } = baseVideos()
  copyFileSync(from ?? (relativePath.endsWith('.mp4') ? mp4 : mkv), target)
  return target
}

export const placeText = (
  root: string,
  relativePath: string,
  content = '1\n00:00:01,000 --> 00:00:02,000\nHello\n',
): string => {
  const target = join(root, relativePath)
  ensureParent(target)
  writeFileSync(target, content)
  return target
}

export const placeCorruptedVideo = (root: string, relativePath: string): string => {
  const target = placeVideo(root, relativePath)
  const size = statSync(target).size
  const fd = openSync(target, 'r+')
  writeSync(
    fd,
    Buffer.alloc(Math.floor(size * 0.65)),
    0,
    Math.floor(size * 0.65),
    Math.floor(size * 0.3),
  )
  closeSync(fd)
  return target
}

export const placeGarbage = (root: string, relativePath: string, sizeBytes = 2_000_000): string => {
  const target = join(root, relativePath)
  ensureParent(target)
  writeFileSync(target, Buffer.alloc(sizeBytes))
  return target
}

export const growFile = (path: string, bytes = 64 * 1024): void => {
  const fd = openSync(path, 'a')
  writeSync(fd, Buffer.alloc(bytes, 1))
  closeSync(fd)
}
