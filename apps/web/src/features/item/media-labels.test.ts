import { describe, expect, test } from 'bun:test'

import {
  audioCodecLabel,
  channelsLabel,
  languageName,
  resolutionLabel,
  videoCodecLabel,
} from './media-labels.ts'

describe('media labels', () => {
  test('codecs', () => {
    expect(videoCodecLabel('h264')).toBe('H.264')
    expect(videoCodecLabel('prores')).toBe('PRORES')
    expect(audioCodecLabel('eac3')).toBe('Dolby Digital Plus')
  })

  test('resolution from height, or width for scope films', () => {
    expect(resolutionLabel(1920, 800)).toBe('1080p')
    expect(resolutionLabel(3840, 2160)).toBe('4K')
    expect(resolutionLabel(640, 360)).toBe('360p')
    expect(resolutionLabel(undefined, undefined)).toBeUndefined()
  })

  test('channels', () => {
    expect(channelsLabel(6)).toBe('5.1')
    expect(channelsLabel(3)).toBe('3 ch')
  })

  test('ISO 639-2 languages, bibliographic codes included', () => {
    expect(languageName('fre', 'en')).toBe('French')
    expect(languageName('eng', 'fr')).toBe('Anglais')
    expect(languageName('und', 'fr')).toBeUndefined()
  })
})
