import { describe, expect, test } from 'bun:test'

import { searchNameOf } from './channel.ts'
import { tvLogoContentType, tvLogoTypeOf } from './logo.ts'
import {
  applySettingsPatch,
  listingSettingsChanged,
  sourceIdOfRefreshKey,
  type TvSourceSettings,
  tvRefreshDedupeKey,
} from './source.ts'

const settings: TvSourceSettings = {
  kind: 'm3u',
  playlistUrl: 'http://p/get.php?password=x',
  guideUrl: 'http://p/xmltv.php',
  userAgent: 'Box/1',
}

describe('applySettingsPatch', () => {
  test('keeps an absent field, replaces a given one, removes an empty one', () => {
    expect(applySettingsPatch(settings, { kind: 'm3u' })).toEqual(settings)
    expect(
      applySettingsPatch(settings, { kind: 'm3u', playlistUrl: 'http://q/list.m3u', guideUrl: '' }),
    ).toEqual({ kind: 'm3u', playlistUrl: 'http://q/list.m3u', userAgent: 'Box/1' })
    expect(applySettingsPatch(settings, { kind: 'm3u', userAgent: '' })).toEqual({
      kind: 'm3u',
      playlistUrl: settings.playlistUrl,
      guideUrl: 'http://p/xmltv.php',
    })
  })
})

describe('listingSettingsChanged', () => {
  test('the playlist URL and User-Agent reach the listing, the guide URL does not', () => {
    const reordered: TvSourceSettings = {
      userAgent: 'Box/1',
      kind: 'm3u',
      playlistUrl: settings.playlistUrl,
    }
    expect(listingSettingsChanged(settings, reordered)).toBe(false)
    expect(listingSettingsChanged(settings, { ...settings, userAgent: 'Box/2' })).toBe(true)
    expect(listingSettingsChanged(settings, { ...settings, playlistUrl: 'http://q' })).toBe(true)
  })
})

test('refresh dedupe keys round-trip', () => {
  expect(sourceIdOfRefreshKey(tvRefreshDedupeKey('s1'))).toBe('s1')
  expect(sourceIdOfRefreshKey('library:s1')).toBeUndefined()
})

test('searchNameOf ignores case and accents', () => {
  expect(searchNameOf('Télé Économie')).toBe('tele economie')
})

describe('logos', () => {
  test('tvLogoTypeOf reads magic signatures and refuses anything else', () => {
    expect(tvLogoTypeOf(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(
      'png',
    )
    expect(tvLogoTypeOf(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('jpg')
    expect(
      tvLogoTypeOf(Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50])),
    ).toBe('webp')
    expect(tvLogoTypeOf(new TextEncoder().encode('GIF89a'))).toBe('gif')
    expect(tvLogoTypeOf(new TextEncoder().encode('<svg xmlns="…"/>'))).toBeUndefined()
    expect(tvLogoTypeOf(new Uint8Array())).toBeUndefined()
  })

  test('tvLogoContentType', () => {
    expect(tvLogoContentType('tv/c1.jpg')).toBe('image/jpeg')
    expect(tvLogoContentType('tv/c1.svg')).toBe('application/octet-stream')
  })
})
