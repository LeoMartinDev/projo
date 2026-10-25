import { describe, expect, test } from 'bun:test'

import type { SubtitleTrackDto } from '@projo/shared/api/playback'

import { parseSubtitleSettings } from './player-settings.ts'
import {
  clampDelay,
  needsNewSession,
  normalizeLanguage,
  parseCueText,
  shiftCue,
  toggledSubtitle,
  vttTrackOf,
} from './subtitles.ts'

const track = (overrides: Partial<SubtitleTrackDto> & { id: string }): SubtitleTrackDto => ({
  origin: 'external',
  format: 'srt',
  forced: false,
  sdh: false,
  isDefault: false,
  delivery: 'vtt',
  url: `/api/v1/subtitles/s/${overrides.id}.vtt`,
  ...overrides,
})

describe('parseCueText', () => {
  test('keeps italic, bold and underline, drops the other tags', () => {
    expect(
      parseCueText('<v Léa>Bonjour <i>toi</i></v>\n<c.yellow>&lt;ok&gt;</c> &amp; <b>fin</b>'),
    ).toEqual([
      [
        { text: 'Bonjour ', italic: false, bold: false, underline: false },
        { text: 'toi', italic: true, bold: false, underline: false },
      ],
      [
        { text: '<ok>', italic: false, bold: false, underline: false },
        { text: ' & ', italic: false, bold: false, underline: false },
        { text: 'fin', italic: false, bold: true, underline: false },
      ],
    ])
  })

  test('a style spans lines, timestamps vanish, numeric entities decode', () => {
    expect(parseCueText('<i>un\ndeux</i> <00:00:01.000>trois&#233;')).toEqual([
      [{ text: 'un', italic: true, bold: false, underline: false }],
      [
        { text: 'deux', italic: true, bold: false, underline: false },
        { text: ' ', italic: false, bold: false, underline: false },
        { text: 'troisé', italic: false, bold: false, underline: false },
      ],
    ])
  })

  test('an out of range or invalid numeric entity is kept as written', () => {
    const plain = (text: string) => ({ text, italic: false, bold: false, underline: false })
    expect(parseCueText('a&#x110000;b')).toEqual([[plain('a&#x110000;b')]])
    expect(parseCueText('a&#99999999999;b')).toEqual([[plain('a&#99999999999;b')]])
    expect(parseCueText('a&#xD800;b&#0;c&#12ab;d')).toEqual([[plain('a&#xD800;b&#0;c&#12ab;d')]])
    expect(parseCueText('&#x1F600;&#x41;')).toEqual([[plain('😀A')]])
  })
})

describe('delay', () => {
  test('a positive delay shows the cue later, never before 0', () => {
    expect(shiftCue({ start: 10, end: 12 }, 1500)).toEqual({ start: 11.5, end: 13.5 })
    expect(shiftCue({ start: 0.5, end: 2 }, -1000)).toEqual({ start: 0, end: 1 })
  })

  test('is clamped to ±10 s', () => {
    expect(clampDelay(25_000)).toBe(10_000)
    expect(clampDelay(-25_000)).toBe(-10_000)
    expect(clampDelay(Number.NaN)).toBe(0)
  })

  test('device settings fall back field by field', () => {
    expect(parseSubtitleSettings({ size: 'large', delayMs: 500 })).toEqual({
      size: 'large',
      delayMs: 500,
    })
    expect(parseSubtitleSettings({ size: 'huge', delayMs: '1' })).toEqual({
      size: 'medium',
      delayMs: 0,
    })
    expect(parseSubtitleSettings('nope')).toEqual({ size: 'medium', delayMs: 0 })
  })
})

describe('choices', () => {
  const fr = track({ id: 'fr', language: 'fre' })
  const frForced = track({ id: 'fr-forced', language: 'fra', forced: true })
  const pgs = track({
    id: 'pgs',
    language: 'eng',
    format: 'hdmv_pgs_subtitle',
    delivery: 'burn_in',
  })
  const vobsub = track({ id: 'sub', format: 'dvd_subtitle', delivery: 'unsupported' })

  test('only burning in (or leaving a burnt-in track) needs a new session', () => {
    expect(needsNewSession({ burnIn: false }, { kind: 'track', track: fr })).toBe(false)
    expect(needsNewSession({ burnIn: false }, { kind: 'off' })).toBe(false)
    expect(needsNewSession({ burnIn: false }, { kind: 'track', track: pgs })).toBe(true)
    expect(needsNewSession({ burnIn: true }, { kind: 'off' })).toBe(true)
  })

  test('the <track> is the selected WebVTT one', () => {
    expect(vttTrackOf([fr, pgs], 'fr')).toBe(fr)
    expect(vttTrackOf([fr, pgs], 'pgs')).toBeUndefined()
    expect(vttTrackOf([fr], undefined)).toBeUndefined()
  })

  test('C turns off, or back on: last track, profile language, then any full track', () => {
    const tracks = [vobsub, frForced, pgs, fr]
    expect(
      toggledSubtitle({ tracks, selectedId: 'fr', lastId: undefined, preferredLanguage: 'fr' }),
    ).toEqual({ kind: 'off' })
    expect(
      toggledSubtitle({ tracks, selectedId: undefined, lastId: 'pgs', preferredLanguage: 'fr' }),
    ).toEqual({ kind: 'track', track: pgs })
    expect(
      toggledSubtitle({
        tracks,
        selectedId: undefined,
        lastId: undefined,
        preferredLanguage: 'fr',
      }),
    ).toEqual({ kind: 'track', track: fr })
    expect(
      toggledSubtitle({
        tracks,
        selectedId: undefined,
        lastId: undefined,
        preferredLanguage: 'de',
      }),
    ).toEqual({ kind: 'track', track: pgs })
    expect(
      toggledSubtitle({
        tracks: [vobsub],
        selectedId: undefined,
        lastId: undefined,
        preferredLanguage: 'fr',
      }),
    ).toBeUndefined()
  })

  test('languages fold to ISO 639-1', () => {
    expect(normalizeLanguage('fre')).toBe('fr')
    expect(normalizeLanguage('FRA')).toBe('fr')
    expect(normalizeLanguage('pt-BR')).toBe('pt')
    expect(normalizeLanguage('xyz')).toBe('xyz')
  })
})
