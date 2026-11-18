import { describe, expect, test } from 'bun:test'

import type { TFunction } from 'i18next'

import { cardImageOf } from './card-image.ts'
import { episodeLabel, episodeLine } from './programme-format.ts'

describe('"On now" card image (§29.6)', () => {
  test("the programme's image, else the channel's logo, else its name", () => {
    const logo = { logoUrl: '/api/v1/tv/channels/c/logo' }
    expect(cardImageOf(logo, { imageUrl: '/api/v1/tv/programmes/p/image' })).toEqual({
      kind: 'programme',
      url: '/api/v1/tv/programmes/p/image',
    })
    expect(cardImageOf(logo, {})).toEqual({ kind: 'logo', url: '/api/v1/tv/channels/c/logo' })
    expect(cardImageOf(logo, undefined)).toEqual({ kind: 'logo', url: logo.logoUrl })
    expect(cardImageOf({}, undefined)).toEqual({ kind: 'name' })
  })
})

describe('episode labels (§29.6)', () => {
  const t = ((key: string, values?: Record<string, unknown>) =>
    `${key}${values === undefined ? '' : JSON.stringify(values)}`) as unknown as TFunction

  test('numbers first, else the on-screen text', () => {
    expect(episodeLabel(t, { season: 2, episode: 5 })).toBe('tv.episode{"season":2,"episode":5}')
    expect(episodeLabel(t, { season: 2 })).toBe('tv.seasonOnly{"season":2}')
    expect(episodeLabel(t, { episode: 5 })).toBe('tv.episodeOnly{"episode":5}')
    expect(episodeLabel(t, { label: 'S02E05' })).toBe('S02E05')
    expect(episodeLabel(t, undefined)).toBeUndefined()
  })

  test('the episode and the subtitle on one line', () => {
    expect(episodeLine(t, { episode: { label: 'Ep. 3' }, subtitle: 'Robin' })).toBe('Ep. 3 · Robin')
    expect(episodeLine(t, { subtitle: 'Robin' })).toBe('Robin')
    expect(episodeLine(t, {})).toBeUndefined()
  })
})
