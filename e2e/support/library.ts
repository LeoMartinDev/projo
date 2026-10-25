import { cpSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { runFfmpeg } from './ffmpeg.ts'
import { incomingDirOf, libraryDirOf, mediaDir, type ServerName, servers } from './paths.ts'

/**
 * The "dossier en vrac" of the first-launch journey (§4, parcours 1), generated with ffmpeg at
 * every run (nothing committed). Tiny H.264 yuv420p + AAC videos, `testsrc` + `sine`, with noise
 * so each file stays above the scanner's 1 MB candidate floor. 24 fps on purpose: MKV's
 * millisecond timestamps around B-frames make ffmpeg 7.x's null muxer warn about DTS, which the
 * scanner's sample decode must not mistake for `decode_failed`.
 */
export type FixtureFile = { path: string; container: 'mkv' | 'mp4'; durationS: number }

export const fixtureFiles = [
  { path: 'Inception.2010.1080p.BluRay.x264-GRP.mkv', container: 'mkv', durationS: 4 },
  // Parcours 3 pauses past 10 s and finishes it: long enough for "Reprendre" (2 % to 93 %).
  { path: 'Heat (1995) [720p].mp4', container: 'mp4', durationS: 24 },
  { path: 'Severance/Season 01/Severance.S01E01.720p.WEB.mkv', container: 'mkv', durationS: 2 },
  { path: 'Severance/Season 01/Severance.S01E02.720p.WEB.mkv', container: 'mkv', durationS: 2 },
  { path: 'Show.Name.S01E02.1080p.WEB.x264.mkv', container: 'mkv', durationS: 2 },
] as const satisfies readonly FixtureFile[]

/**
 * Parcours 5: a file that arrives later, under a French scene abbreviation ("Le Fabuleux Destin
 * d'Amélie Poulain") that TMDB cannot find. Staged outside the library, moved in by the test.
 */
export const unidentifiedFile = {
  path: 'LFDDAP.2001.MULTi.1080p.BluRay.x264.mkv',
  container: 'mkv',
  durationS: 2,
} as const satisfies FixtureFile

/** What the catalog must show for that folder: clean titles, no release noise. */
export const expectedMovies = [
  { title: 'Heat', year: 1995 },
  { title: 'Inception', year: 2010 },
] as const

export const expectedSeries = ['Severance', 'Show Name'] as const

/** Identified on TMDB (recorded responses): they get a poster. "Show Name" stays unidentified. */
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

/**
 * Generates every video once into `mediaDir`, then gives each browser its own library folder
 * (the wizard's "dossier en vrac") and its staging folder with the file journey 5 drops in.
 */
export const generateLibraries = (): void => {
  rmSync(mediaDir, { recursive: true, force: true })
  for (const file of [...fixtureFiles, unidentifiedFile]) generate(file, join(mediaDir, file.path))
  for (const name of Object.keys(servers) as ServerName[]) {
    const library = libraryDirOf(name)
    const incoming = incomingDirOf(name)
    rmSync(library, { recursive: true, force: true })
    rmSync(incoming, { recursive: true, force: true })
    for (const file of fixtureFiles) {
      mkdirSync(dirname(join(library, file.path)), { recursive: true })
      cpSync(join(mediaDir, file.path), join(library, file.path))
    }
    mkdirSync(incoming, { recursive: true })
    cpSync(join(mediaDir, unidentifiedFile.path), join(incoming, unidentifiedFile.path))
  }
}
