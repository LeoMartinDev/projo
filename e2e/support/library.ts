import { rmSync } from 'node:fs'
import { join } from 'node:path'

import { runFfmpeg } from './ffmpeg.ts'
import { incomingDir, libraryDir } from './paths.ts'

export type FixtureFile = { path: string; container: 'mkv' | 'mp4'; durationS: number }

export const fixtureFiles = [
  { path: 'Inception.2010.1080p.BluRay.x264-GRP.mkv', container: 'mkv', durationS: 4 },
  { path: 'Heat (1995) [720p].mp4', container: 'mp4', durationS: 24 },
  { path: 'Severance/Season 01/Severance.S01E01.720p.WEB.mkv', container: 'mkv', durationS: 2 },
  { path: 'Severance/Season 01/Severance.S01E02.720p.WEB.mkv', container: 'mkv', durationS: 2 },
  { path: 'Show.Name.S01E02.1080p.WEB.x264.mkv', container: 'mkv', durationS: 2 },
] as const satisfies readonly FixtureFile[]

export const unidentifiedFile = {
  path: 'LFDDAP.2001.MULTi.1080p.BluRay.x264.mkv',
  container: 'mkv',
  durationS: 2,
} as const satisfies FixtureFile

export const expectedMovies = [
  { title: 'Heat', year: 1995 },
  { title: 'Inception', year: 2010 },
] as const

export const expectedSeries = ['Severance', 'Show Name'] as const

export const identifiedTitles = ['Heat', 'Inception', 'Severance'] as const

const ffmpegArgs = ({ container, durationS }: FixtureFile): string[] => [
  '-f',
  'lavfi',
  '-i',
  'testsrc=size=320x240:rate=24',
  '-f',
  'lavfi',
  '-i',
  'sine=frequency=440:sample_rate=48000',
  '-t',
  String(durationS),
  '-vf',
  'noise=alls=40:allf=t',
  '-c:v',
  'libx264',
  '-preset',
  'ultrafast',
  '-crf',
  '18',
  '-profile:v',
  'high',
  '-pix_fmt',
  'yuv420p',
  '-g',
  '48',
  '-sc_threshold',
  '0',
  '-c:a',
  'aac',
  '-b:a',
  '128k',
  '-shortest',
  ...(container === 'mp4' ? ['-movflags', '+faststart'] : []),
]

const generate = (file: FixtureFile, output: string): void => runFfmpeg(ffmpegArgs(file), output)

export const generateLibraries = (): void => {
  rmSync(libraryDir, { recursive: true, force: true })
  rmSync(incomingDir, { recursive: true, force: true })
  for (const file of fixtureFiles) generate(file, join(libraryDir, file.path))
  generate(unidentifiedFile, join(incomingDir, unidentifiedFile.path))
}
