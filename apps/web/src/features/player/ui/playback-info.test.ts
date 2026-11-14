import { expect, test } from 'bun:test'
import i18next, { type TFunction } from 'i18next'

import { resources } from '@projo/i18n'
import { sessionDto } from '@projo/player/testing/fake-api'

import { formatBitrate, playbackInfoGroups } from './playback-info.ts'

const french = async (): Promise<TFunction> => {
  const instance = i18next.createInstance()
  await instance.init({ resources, lng: 'fr', interpolation: { escapeValue: false } })
  return instance.t
}

// Intl separates a number from its unit with a no-break space.
const rowsOf = (groups: ReturnType<typeof playbackInfoGroups>) =>
  Object.fromEntries(
    groups.map((group) => [
      group.title,
      group.rows.map((row) => `${row.label}: ${row.value.replace(/\s/g, ' ')}`),
    ]),
  )

test('a 4K HDR transcode: why, the file, what the server sends, what the browser decodes', async () => {
  const session = sessionDto('s1', {
    mode: 'hls_transcode',
    quality: '720p',
    transcodeReasons: ['video_codec', 'quality'],
    media: {
      container: 'mkv',
      sizeBytes: 5_400_000_000,
      bitrate: 5_800_000,
      video: {
        codec: 'hevc',
        profile: 'Main 10',
        width: 3840,
        height: 2074,
        pixelFormat: 'yuv420p10le',
        dynamicRange: 'hdr',
      },
    },
    audioTracks: [{ index: 1, codec: 'ac3', channels: 6, language: 'ja', isDefault: true }],
  })
  const groups = playbackInfoGroups({
    t: await french(),
    locale: 'fr',
    session,
    live: {
      engine: {
        width: 1280,
        height: 692,
        droppedFrames: 2,
        totalFrames: 900,
        bandwidth: 4_000_000,
      },
      transcode: {
        running: true,
        acceleration: 'software',
        preset: 'ultrafast',
        speed: 0.8,
        hdr: 'tonemapped',
      },
    },
    audioIndex: 1,
    subtitleId: undefined,
    bufferAheadS: 12.34,
  })
  expect(rowsOf(groups)).toEqual({
    Session: ['Mode: Transcodage HLS · codec vidéo non lu, qualité réduite', 'Qualité: 720p'],
    Fichier: [
      'Conteneur: MKV · 5,4 Go · 5,8 Mb/s',
      'Vidéo: HEVC Main 10 · 3840×2074 · yuv420p10le · HDR',
      'Audio: Dolby Digital · 5.1 · ja',
      'Sous-titres: Désactivés',
    ],
    'Envoyé par le serveur': [
      'Vidéo: H.264 · 720p',
      'Audio: AAC',
      'ffmpeg: En cours · CPU (x264) · ultrafast · ×0,8',
      'HDR: Converti en SDR (tone mapping)',
    ],
    Lecteur: [
      'Image: 1280×692',
      'Images perdues: 2 / 900',
      'Débit estimé: 4 Mb/s',
      'Tampon: 12,3 s',
    ],
  })
  const ffmpeg = groups[2]?.rows.find((row) => row.label === 'ffmpeg')
  expect(ffmpeg?.warn).toBe(true)
})

test('direct play asks nothing of ffmpeg and sends the file as is', async () => {
  const groups = playbackInfoGroups({
    t: await french(),
    locale: 'fr',
    session: sessionDto('s1', { mode: 'direct', media: { container: 'mp4', sizeBytes: 1000 } }),
    live: { engine: { hardwareDecoding: 'no' }, transcode: undefined },
    audioIndex: undefined,
    subtitleId: undefined,
    bufferAheadS: undefined,
  })
  expect(rowsOf(groups)['Envoyé par le serveur']).toEqual(['Vidéo: Tel quel'])
  expect(rowsOf(groups)['Lecteur']).toEqual(['Décodage: Logiciel'])
})

test('bitrates in Mb/s from 1 Mb/s, else kb/s', () => {
  expect(formatBitrate(45_230_000, 'fr')).toBe('45,2 Mb/s')
  expect(formatBitrate(500_000, 'en')).toBe('500 kb/s')
})
