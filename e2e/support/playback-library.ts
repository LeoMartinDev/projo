import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { runFfmpeg } from './ffmpeg.ts'
import { mediaDir, playbackDir } from './paths.ts'

/**
 * The "Playback" library of the M3 journeys (§10, §11, §23 M3), generated with ffmpeg at every run
 * (nothing committed), added by the journeys themselves (`ensurePlaybackLibrary`) so the
 * first-launch catalog stays as it is. Titles TMDB does not
 * know: the items keep their parsed titles and no original language, the track cascade only
 * depends on the profile (French, `when_audio_differs`) and the files.
 */
export type Cue = { startS: number; endS: number; text: string }

/** A named chapter of the file (an `ffmetadata` input), on the file timeline. */
export type Chapter = { startS: number; endS: number; title: string }

export type PlaybackFixture = {
  /** Relative to the library root. */
  path: string
  durationS: number
  size: '320x240' | '854x480'
  /** `h264_high10`: H.264 High 10 (yuv420p10le), which no browser decodes: `hls_transcode`. */
  video: 'h264' | 'h264_high10'
  /** First (default) audio track, ISO 639-2 tag. */
  audio: { codec: 'aac' | 'ac3'; language: string }
  /** More audio tracks of the same codec, a tone of their own each, in order. */
  moreAudio?: readonly { language: string }[]
  /** Named chapters (§12.2 row 2: `Intro`, `Credits`… become segments). */
  chapters?: readonly Chapter[]
  /** Embedded SubRip tracks, in order. */
  embedded?: readonly { language: string; cues: readonly Cue[] }[]
  /** External `<video base name>.<suffix>.srt` files next to the video (§8.3). */
  external?: readonly { suffix: string; cues: readonly Cue[] }[]
}

/** Cues of the French external file of the English-audio movie (parcours 2). */
export const frenchCues = [
  { startS: 0.5, endS: 3.5, text: 'Bonjour, première réplique' },
  { startS: 4.5, endS: 9, text: 'Seconde réplique en français' },
] as const satisfies readonly Cue[]

export const englishCues = [
  { startS: 0.5, endS: 3.5, text: 'First English line' },
  { startS: 4.5, endS: 9, text: 'Second English line' },
] as const satisfies readonly Cue[]

/** 40 s: switching tracks from the menu must not reach the end (and chain the next episode). */
const episodeDurationS = 40

const episodeCues = (episode: number) => ({
  french: [
    { startS: 0.5, endS: episodeDurationS - 1, text: `Réplique française de l’épisode ${episode}` },
  ],
  english: [
    { startS: 0.5, endS: episodeDurationS - 1, text: `English line of episode ${episode}` },
  ],
})

const episode = (number: number): PlaybackFixture => {
  const cues = episodeCues(number)
  return {
    path: `Glimmerdeep/Season 01/Glimmerdeep.S01E0${number}.mkv`,
    durationS: episodeDurationS,
    size: '320x240',
    video: 'h264',
    audio: { codec: 'aac', language: 'eng' },
    embedded: [{ language: 'eng', cues: cues.english }],
    external: [{ suffix: 'fr', cues: cues.french }],
  }
}

/**
 * Parcours 4 (§4, §12.4): a series TMDB does not know, its segments from the chapters of its
 * files only. 40 s episodes: intro 3 s → 15 s, credits over the last 12 s (28 s → 40 s), French
 * then English audio, English embedded and French external subtitles.
 */
export const seriesTimeline = {
  durationS: 40,
  intro: { startS: 3, endS: 15 },
  credits: { startS: 28, endS: 40 },
} as const

const seriesEpisode = (number: number): PlaybackFixture => {
  const { durationS, intro, credits } = seriesTimeline
  const cue = (text: string) => [{ startS: 0.5, endS: durationS - 0.5, text }]
  return {
    path: `Brackenmoor/Season 01/Brackenmoor.S01E0${number}.mkv`,
    durationS,
    size: '320x240',
    video: 'h264',
    audio: { codec: 'aac', language: 'fra' },
    moreAudio: [{ language: 'eng' }],
    embedded: [{ language: 'eng', cues: cue(`Brackenmoor English line ${number}`) }],
    external: [{ suffix: 'fr', cues: cue(`Brackenmoor réplique française ${number}`) }],
    chapters: [
      { startS: 0, endS: intro.startS, title: 'Cold open' },
      { startS: intro.startS, endS: intro.endS, title: 'Intro' },
      { startS: intro.endS, endS: credits.startS, title: 'Chapter 2' },
      { startS: credits.startS, endS: credits.endS, title: 'Credits' },
    ],
  }
}

export const playbackFixtures = {
  /** Parcours M3-1: H.264 High 10 + AC-3 in a MKV: transcoded on every browser. */
  transcode: {
    path: 'Zorblax Signal (2021)/Zorblax Signal (2021).mkv',
    durationS: 30,
    size: '320x240',
    video: 'h264_high10',
    audio: { codec: 'ac3', language: 'eng' },
  },
  /** Parcours M3-2: English audio, French external SRT, English embedded track. */
  englishAudio: {
    path: 'Kestrel Dawn (2020)/Kestrel Dawn (2020).mkv',
    durationS: 12,
    size: '320x240',
    video: 'h264',
    audio: { codec: 'aac', language: 'eng' },
    embedded: [{ language: 'eng', cues: englishCues }],
    external: [{ suffix: 'fr', cues: frenchCues }],
  },
  /** Parcours M3-2: French audio, the same tracks: no subtitles. */
  frenchAudio: {
    path: 'Oriole Morning (2019)/Oriole Morning (2019).mkv',
    durationS: 12,
    size: '320x240',
    video: 'h264',
    audio: { codec: 'aac', language: 'fra' },
    embedded: [{ language: 'eng', cues: englishCues }],
    external: [{ suffix: 'fr', cues: frenchCues }],
  },
  /** Parcours M3-3: two episodes of one series, English audio, French and English subtitles. */
  episode1: episode(1),
  episode2: episode(2),
  /** Parcours M3-4 and 5: 480p H.264 + AAC MP4 (`direct`, 480p offered). */
  quality: {
    path: 'Heron Lake (2022)/Heron Lake (2022).mp4',
    durationS: 30,
    size: '854x480',
    video: 'h264',
    audio: { codec: 'aac', language: 'eng' },
  },
  /** Parcours M3-6: a movie in two parts (§7.7). */
  partOne: {
    path: 'Lark Hollow (2018)/Lark Hollow (2018) cd1.mkv',
    durationS: 8,
    size: '320x240',
    video: 'h264',
    audio: { codec: 'aac', language: 'eng' },
  },
  partTwo: {
    path: 'Lark Hollow (2018)/Lark Hollow (2018) cd2.mkv',
    durationS: 8,
    size: '320x240',
    video: 'h264',
    audio: { codec: 'aac', language: 'eng' },
  },
  /** Parcours 4: two episodes with `Intro` and `Credits` chapters, two audio tracks. */
  seriesEpisode1: seriesEpisode(1),
  seriesEpisode2: seriesEpisode(2),
} as const satisfies Record<string, PlaybackFixture>

export type PlaybackFixtureName = keyof typeof playbackFixtures

/** Video files of the library (a stack counts its parts). */
export const playbackFixtureCount = Object.keys(playbackFixtures).length

const srtTime = (seconds: number) => {
  const ms = Math.round(seconds * 1000)
  const pad = (value: number, size = 2) => String(value).padStart(size, '0')
  return `${pad(Math.floor(ms / 3_600_000))}:${pad(Math.floor(ms / 60_000) % 60)}:${pad(Math.floor(ms / 1000) % 60)},${pad(ms % 1000, 3)}`
}

const srt = (cues: readonly Cue[]) =>
  cues
    .map(
      (cue, index) =>
        `${index + 1}\n${srtTime(cue.startS)} --> ${srtTime(cue.endS)}\n${cue.text}\n`,
    )
    .join('\n')

const withoutExtension = (path: string) => path.replace(/\.[^./]+$/, '')

/** `ffmetadata` chapters (millisecond time base) of a fixture. */
const ffmetadata = (chapters: readonly Chapter[]) =>
  [
    ';FFMETADATA1',
    ...chapters.flatMap((chapter) => [
      '[CHAPTER]',
      'TIMEBASE=1/1000',
      `START=${Math.round(chapter.startS * 1000)}`,
      `END=${Math.round(chapter.endS * 1000)}`,
      `title=${chapter.title}`,
    ]),
    '',
  ].join('\n')

/** Temporary files muxed into a fixture: SRT per embedded track, `ffmetadata` for chapters. */
type ExtraInputs = { subtitles: readonly string[]; chapters?: string }

/**
 * `testsrc` + one `sine` per audio track (440 Hz, then 660 Hz…) with noise (the scanner ignores
 * files under 1 MB), a keyframe every 2 s, 24 fps (see `library.ts`), the embedded SubRip
 * tracks muxed from temporary SRT files, the chapters from an `ffmetadata` file.
 */
const ffmpegArgs = (fixture: PlaybackFixture, extra: ExtraInputs): string[] => {
  const { durationS, size, video, audio } = fixture
  const large = size === '854x480'
  const audioTracks = [audio.language, ...(fixture.moreAudio ?? []).map((t) => t.language)]
  const subtitleBase = 1 + audioTracks.length
  const chaptersInput = subtitleBase + extra.subtitles.length
  return [
    '-f',
    'lavfi',
    '-i',
    `testsrc=size=${size}:rate=24:duration=${durationS}`,
    ...audioTracks.flatMap((_, index) => [
      '-f',
      'lavfi',
      '-i',
      `sine=frequency=${440 + 220 * index}:sample_rate=48000:duration=${durationS}`,
    ]),
    ...extra.subtitles.flatMap((input) => ['-i', input]),
    ...(extra.chapters === undefined ? [] : ['-f', 'ffmetadata', '-i', extra.chapters]),
    '-map',
    '0:v',
    ...audioTracks.flatMap((_, index) => ['-map', `${index + 1}:a`]),
    ...extra.subtitles.flatMap((_, index) => ['-map', `${subtitleBase + index}:s`]),
    ...(extra.chapters === undefined ? [] : ['-map_chapters', String(chaptersInput)]),
    '-vf',
    `noise=alls=${large ? 12 : 30}:allf=t`,
    '-c:v',
    'libx264',
    '-preset',
    'ultrafast',
    '-crf',
    large ? '34' : '30',
    ...(video === 'h264_high10'
      ? ['-profile:v', 'high10', '-pix_fmt', 'yuv420p10le']
      : ['-profile:v', 'high', '-pix_fmt', 'yuv420p']),
    '-g',
    '48',
    '-sc_threshold',
    '0',
    '-c:a',
    audio.codec,
    '-b:a',
    audio.codec === 'ac3' ? '192k' : '128k',
    ...audioTracks.flatMap((language, index) => [`-metadata:s:a:${index}`, `language=${language}`]),
    ...(extra.subtitles.length === 0 ? [] : ['-c:s', 'srt']),
    ...(fixture.embedded ?? []).flatMap((track, index) => [
      `-metadata:s:s:${index}`,
      `language=${track.language}`,
    ]),
    ...(fixture.path.endsWith('.mp4') ? ['-movflags', '+faststart'] : []),
  ]
}

const generate = (fixture: PlaybackFixture, root: string, scratch: string): void => {
  const output = join(root, fixture.path)
  const scratchName = withoutExtension(fixture.path).replaceAll('/', '_')
  const write = (name: string, content: string) => {
    const file = join(scratch, name)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, content)
    return file
  }
  const subtitles = (fixture.embedded ?? []).map((track, index) =>
    write(`${scratchName}.${index}.srt`, srt(track.cues)),
  )
  const chapters =
    fixture.chapters === undefined
      ? undefined
      : write(`${scratchName}.ffmetadata`, ffmetadata(fixture.chapters))
  runFfmpeg(
    ffmpegArgs(fixture, { subtitles, ...(chapters === undefined ? {} : { chapters }) }),
    output,
  )
  for (const { suffix, cues } of fixture.external ?? []) {
    writeFileSync(join(root, `${withoutExtension(fixture.path)}.${suffix}.srt`), srt(cues))
  }
}

/** Generates the library into `playbackDir`, its temporary inputs into `mediaDir`. */
export const generatePlaybackLibrary = (): void => {
  rmSync(playbackDir, { recursive: true, force: true })
  const scratch = join(mediaDir, 'playback-subtitles')
  for (const fixture of Object.values(playbackFixtures)) generate(fixture, playbackDir, scratch)
}
