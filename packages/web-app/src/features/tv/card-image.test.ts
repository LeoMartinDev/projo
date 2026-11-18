import { describe, expect, test } from 'bun:test'

import type { TFunction } from 'i18next'

import { cardImageOf, cardImagesOf } from './card-image.ts'
import { episodeLabel, episodeLine } from './programme-format.ts'

describe("a card's image (§29.6)", () => {
  const at = Date.parse('2026-11-18T20:00:00.000Z')
  const logo = { logoUrl: '/api/v1/tv/channels/c/logo' }
  const programme = { imageUrl: '/api/v1/tv/programmes/p/image' }
  const snapshotAt = (minutesAgo: number) => ({
    url: `/api/v1/tv/channels/c/snapshot?v=${at - minutesAgo * 60_000}`,
    takenAt: new Date(at - minutesAgo * 60_000).toISOString(),
  })

  test("the programme's image, else the channel's logo, else its name", () => {
    expect(cardImageOf(logo, programme, at)).toEqual({ kind: 'programme', url: programme.imageUrl })
    expect(cardImageOf(logo, {}, at)).toEqual({ kind: 'logo', url: '/api/v1/tv/channels/c/logo' })
    expect(cardImageOf(logo, undefined, at)).toEqual({ kind: 'logo', url: logo.logoUrl })
    expect(cardImageOf({}, undefined, at)).toEqual({ kind: 'name' })
  })

  test('a snapshot under an hour old comes first; an older one gives way', () => {
    const fresh = { ...logo, snapshot: snapshotAt(59) }
    expect(cardImageOf(fresh, programme, at)).toEqual({ kind: 'snapshot', url: fresh.snapshot.url })
    expect(cardImageOf({ ...logo, snapshot: snapshotAt(60) }, programme, at)).toEqual({
      kind: 'programme',
      url: programme.imageUrl,
    })
    // Each picture that fails to load steps down to the next.
    expect(cardImagesOf(fresh, programme, at).map((image) => image.kind)).toEqual([
      'snapshot',
      'programme',
      'logo',
      'name',
    ])
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
