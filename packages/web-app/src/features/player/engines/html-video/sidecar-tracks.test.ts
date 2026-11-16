import { describe, expect, test } from 'bun:test'

import type { SubtitleTrackDto } from '@projo/shared/api/playback'

import { attachSidecarTracks, type TrackParent } from './sidecar-tracks.ts'

type FakeCue = { startTime: number; endTime: number }

type FakeTrack = {
  kind: string
  label: string
  srclang: string
  default: boolean
  src: string
  track: { mode: TextTrackMode; cues: FakeCue[] | undefined }
  removed: boolean
  listeners: Set<() => void>
  addEventListener: (type: string, listener: () => void) => void
  removeEventListener: (type: string, listener: () => void) => void
  remove: () => void
  // The browser loaded the WebVTT: its cues, then `load`.
  load: (cues: FakeCue[]) => void
}

const fakeTrack = (): FakeTrack => {
  const element: FakeTrack = {
    kind: '',
    label: '',
    srclang: '',
    default: false,
    src: '',
    track: { mode: 'disabled', cues: undefined },
    removed: false,
    listeners: new Set(),
    addEventListener: (_type, listener) => void element.listeners.add(listener),
    removeEventListener: (_type, listener) => void element.listeners.delete(listener),
    remove: () => {
      element.removed = true
    },
    load: (cues) => {
      element.track.cues = cues
      for (const listener of [...element.listeners]) listener()
    },
  }
  return element
}

const fakeVideo = () => {
  const children: FakeTrack[] = []
  const metadata = new Set<() => void>()
  const video: TrackParent = {
    append: (element) => void children.push(element as unknown as FakeTrack),
    addEventListener: (_type, listener) => void metadata.add(listener),
    removeEventListener: (_type, listener) => void metadata.delete(listener),
  }
  return { video, children, metadata }
}

const track = (
  id: string,
  extra: Partial<SubtitleTrackDto> = {},
  delivery: SubtitleTrackDto['delivery'] = 'vtt',
): SubtitleTrackDto => ({
  id,
  origin: 'external',
  format: 'srt',
  forced: false,
  sdh: false,
  isDefault: false,
  delivery,
  ...(delivery === 'vtt' ? { url: `/api/v1/stream/s1/secret/tracks/${id}.vtt` } : {}),
  ...extra,
})

const tracks = [
  track('fr', { language: 'fr' }),
  track('en', { language: 'en', title: 'English' }),
  track('pgs', { language: 'en' }, 'burn_in'),
  track('fr-2', { language: 'fr' }),
]

const attach = (selectedId: string | undefined, delayMs = 0) => {
  const world = fakeVideo()
  const sidecar = attachSidecarTracks({
    video: world.video,
    tracks,
    selectedId,
    delayMs,
    resolveUrl: (url) => `https://projo.test${url}`,
    createTrack: () => fakeTrack() as unknown as HTMLTrackElement,
  })
  return { ...world, sidecar }
}

describe('sidecar <track>s (§10.4)', () => {
  test('one <track> per WebVTT track, labelled like the renditions, the selected one shown', () => {
    const { children } = attach('en')
    expect(
      children.map(({ kind, label, srclang, default: isDefault, src, track: { mode } }) => ({
        kind,
        label,
        srclang,
        isDefault,
        src,
        mode,
      })),
    ).toEqual([
      {
        kind: 'subtitles',
        label: 'fr',
        srclang: 'fr',
        isDefault: false,
        src: 'https://projo.test/api/v1/stream/s1/secret/tracks/fr.vtt',
        mode: 'disabled',
      },
      {
        kind: 'subtitles',
        label: 'English',
        srclang: 'en',
        isDefault: true,
        src: 'https://projo.test/api/v1/stream/s1/secret/tracks/en.vtt',
        mode: 'showing',
      },
      {
        kind: 'subtitles',
        label: 'fr (2)',
        srclang: 'fr',
        isDefault: false,
        src: 'https://projo.test/api/v1/stream/s1/secret/tracks/fr-2.vtt',
        mode: 'disabled',
      },
    ])
  })

  test('a selection changes the track shown, without touching the stream', () => {
    const { children, sidecar } = attach(undefined)
    expect(children.map((child) => child.track.mode)).toEqual(['disabled', 'disabled', 'disabled'])
    sidecar.select('fr-2')
    expect(children.map((child) => child.track.mode)).toEqual(['disabled', 'disabled', 'showing'])
    sidecar.select(undefined)
    expect(children.map((child) => child.track.mode)).toEqual(['disabled', 'disabled', 'disabled'])
  })

  test('the selection wins over the browser once the metadata is there', () => {
    const { children, metadata } = attach('fr')
    const [fr, en] = children
    if (fr === undefined || en === undefined) throw new Error('tracks missing')
    fr.track.mode = 'disabled'
    en.track.mode = 'showing'
    for (const listener of metadata) listener()
    expect(children.map((child) => child.track.mode)).toEqual(['showing', 'disabled', 'disabled'])
  })

  test('the delay moves the cues of a track as it loads and on every change', () => {
    const { children, sidecar } = attach('fr', 500)
    const fr = children[0]
    if (fr === undefined) throw new Error('track missing')
    fr.load([
      { startTime: 1, endTime: 2 },
      { startTime: 0.2, endTime: 0.4 },
    ])
    expect(fr.track.cues).toEqual([
      { startTime: 1.5, endTime: 2.5 },
      { startTime: 0.7, endTime: 0.9 },
    ])
    sidecar.setDelay(-500)
    expect(fr.track.cues).toEqual([
      { startTime: 0.5, endTime: 1.5 },
      { startTime: 0, endTime: 0 },
    ])
    sidecar.setDelay(0)
    expect(fr.track.cues?.[1]).toEqual({ startTime: 0.2, endTime: 0.4 })
  })

  test('detach removes every track and stops following the media', () => {
    const { children, metadata, sidecar } = attach('fr')
    sidecar.detach()
    expect(children.every((child) => child.removed && child.track.mode === 'disabled')).toBe(true)
    expect(children.every((child) => child.listeners.size === 0)).toBe(true)
    expect(metadata.size).toBe(0)
  })
})
