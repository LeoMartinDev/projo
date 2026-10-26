import { describe, expect, test } from 'bun:test'
import i18next, { type TFunction } from 'i18next'

import { interfaceCountry, ratingBadge } from './content-ratings.ts'
import { resources } from './index.ts'

const translator = async (lng: 'fr' | 'en'): Promise<TFunction> => {
  const instance = i18next.createInstance()
  await instance.init({ resources, lng, interpolation: { escapeValue: false } })
  return instance.t
}

const badge = async (lng: 'fr' | 'en', rating: Parameters<typeof ratingBadge>[2]) =>
  ratingBadge(await translator(lng), lng, rating)

describe('classification badge (§13.5), composed from code, country and tier', () => {
  test('the interface language has a country', () => {
    expect(interfaceCountry('fr')).toBe('FR')
    expect(interfaceCountry('en')).toBe('US')
  })

  test('all ages, whatever the scale', async () => {
    for (const code of ['TP', 'U']) {
      expect(await badge('fr', { code, country: 'FR', tier: '0' })).toEqual({
        text: 'TP',
        label: 'Tous publics',
      })
      expect(await badge('en', { code, country: 'FR', tier: '0' })).toEqual({
        text: 'ALL',
        label: 'All ages',
      })
    }
    expect(await badge('fr', { code: 'G', country: 'US', tier: '0' })).toEqual({
      text: 'TP',
      label: 'Tous publics',
    })
  })

  test('French age codes speak for themselves', async () => {
    expect(await badge('fr', { code: '12', country: 'FR', tier: '12' })).toEqual({
      text: '12',
      label: 'Déconseillé aux moins de 12 ans',
    })
    expect(await badge('en', { code: '16', country: 'FR', tier: '16' })).toEqual({
      text: '16',
      label: 'Not suitable under 16 (France)',
    })
  })

  test('a US fallback: its country in French, its code in English', async () => {
    expect(await badge('fr', { code: 'R', country: 'US', tier: '18' })).toEqual({
      text: 'R (US)',
      label: 'Classification R (États-Unis) · 18 ans et plus',
    })
    expect(await badge('en', { code: 'R', country: 'US', tier: '18' })).toEqual({
      text: 'R',
      label: 'Rated R (United States) · 18 and over',
    })
    expect(await badge('en', { code: '12A', country: 'GB', tier: '12' })).toEqual({
      text: '12A (GB)',
      label: 'Rated 12A (United Kingdom) · 12 and over',
    })
  })

  test('not rated: no badge; unknown tier or country: the code alone', async () => {
    expect(await badge('fr', { code: 'NR', country: 'US' })).toBeUndefined()
    expect(await badge('en', { code: 'NR', country: 'US' })).toBeUndefined()
    expect(await badge('fr', undefined)).toBeUndefined()
    expect(await badge('fr', { code: 'X' })).toEqual({ text: 'X', label: 'Classification X' })
    expect(await badge('fr', { code: 'TP' })).toEqual({ text: 'TP', label: 'Classification TP' })
  })
})
