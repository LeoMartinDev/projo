import { describe, expect, test } from 'bun:test'
import i18next, { type TFunction } from 'i18next'

import { resources } from './index.ts'
import { editionLabel, versionLabel, versionLabels } from './versions.ts'

const translator = async (lng: 'fr' | 'en'): Promise<TFunction> => {
  const instance = i18next.createInstance()
  await instance.init({ resources, lng, interpolation: { escapeValue: false } })
  return instance.t
}

describe('version labels (§7.7), composed from codes', () => {
  test('resolution, dynamic range, codec, then the edition in the interface language', async () => {
    const version = {
      resolution: '2160p',
      dynamicRange: 'hdr',
      videoCodec: 'hevc',
      edition: 'extended',
    } as const
    expect(versionLabel(await translator('fr'), version)).toBe('2160p HDR HEVC · Version longue')
    expect(versionLabel(await translator('en'), version)).toBe('2160p HDR HEVC · Extended Cut')
  })

  test('SDR says nothing, Dolby Vision is DV, unknown codecs in capitals', async () => {
    const t = await translator('fr')
    expect(versionLabel(t, { resolution: '1080p', dynamicRange: 'sdr', videoCodec: 'h264' })).toBe(
      '1080p H.264',
    )
    expect(versionLabel(t, { resolution: '2160p', dynamicRange: 'dv', videoCodec: 'av1' })).toBe(
      '2160p DV AV1',
    )
    expect(versionLabel(t, { videoCodec: 'prores' })).toBe('PRORES')
    expect(versionLabel(t, {})).toBeUndefined()
  })

  test('a tag keeps its own text', async () => {
    const t = await translator('en')
    expect(editionLabel(t, { editionName: 'Cut 4K' })).toBe('Cut 4K')
    expect(editionLabel(t, { edition: 'directors_cut' })).toBe("Director's Cut")
    expect(editionLabel(await translator('fr'), { edition: 'theatrical' })).toBe('Version cinéma')
    expect(versionLabel(t, { editionName: 'Cut 4K' })).toBe('Cut 4K')
  })

  test('two versions of an item always read differently', async () => {
    const t = await translator('fr')
    const uhd = { resolution: '2160p', dynamicRange: 'hdr', videoCodec: 'hevc' } as const
    const hd = { resolution: '1080p', dynamicRange: 'sdr', videoCodec: 'h264' } as const
    expect(versionLabels(t, [uhd, hd])).toEqual(['2160p HDR HEVC', '1080p H.264'])
    expect(versionLabels(t, [uhd, { ...uhd, edition: 'directors_cut' }])).toEqual([
      '2160p HDR HEVC',
      "2160p HDR HEVC · Director's cut",
    ])
    expect(versionLabels(t, [hd, hd, {}])).toEqual([
      '1080p H.264 · Version 1',
      '1080p H.264 · Version 2',
      'Version 3',
    ])
    expect(versionLabels(await translator('en'), [hd, hd])).toEqual([
      '1080p H.264 · Version 1',
      '1080p H.264 · Version 2',
    ])
  })
})
