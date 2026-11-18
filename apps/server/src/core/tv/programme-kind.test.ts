import { describe, expect, test } from 'bun:test'

import { categoryKindOf, channelKindOf, kindWordsOf, programmeKindOf } from './programme-kind.ts'

describe('programme kinds (§29.3)', () => {
  test('words: lowercased, accents removed, compounds joined', () => {
    expect(kindWordsOf("Film d'animation")).toEqual(['film', 'd', 'animation'])
    expect(kindWordsOf('Science-fiction / Fantastique')).toEqual(['scifi', 'fantastique'])
    expect(kindWordsOf('  ')).toEqual([])
  })

  test('French categories', () => {
    const fr = (text: string) => categoryKindOf({ lang: 'fr', text })
    expect(fr('Film')).toBe('movie')
    expect(fr('Téléfilm')).toBe('movie')
    expect(fr('Film de science-fiction')).toBe('movie')
    expect(fr('Série')).toBe('series')
    expect(fr('Séries TV')).toBe('series')
    expect(fr('Feuilleton')).toBe('series')
    expect(fr('Journal')).toBe('news')
    expect(fr("Magazine d'information")).toBe('news')
    expect(fr('Météo')).toBe('news')
    expect(fr('Documentaire')).toBe('documentary')
    expect(fr('Série documentaire')).toBe('documentary')
    expect(fr('Football')).toBe('sport')
    expect(fr('Magazine sportif')).toBe('sport')
    expect(fr('Arts martiaux')).toBe('sport')
    expect(fr('Jeunesse')).toBe('kids')
    expect(fr('Dessin animé')).toBe('kids')
    expect(fr('Divertissement')).toBe('entertainment')
    expect(fr('Jeu')).toBe('entertainment')
    expect(fr('Téléréalité')).toBe('entertainment')
    expect(fr('Musique')).toBe('music')
    expect(fr('Concert')).toBe('music')
    expect(fr('Autre')).toBeUndefined()
  })

  test('English categories and the DVB EIT content strings', () => {
    const en = (text: string) => categoryKindOf({ lang: 'en', text })
    expect(en('Movie')).toBe('movie')
    expect(en('Sitcom')).toBe('series')
    expect(en('News')).toBe('news')
    expect(en('Documentary')).toBe('documentary')
    expect(en('Sports')).toBe('sport')
    expect(en('Children')).toBe('kids')
    expect(en('Game show')).toBe('entertainment')
    expect(en('Music')).toBe('music')
    expect(en('Movie / Drama')).toBe('movie')
    expect(en('Detective / Thriller')).toBe('movie')
    expect(en('Science fiction / Fantasy / Horror')).toBe('movie')
    expect(en('Serious / Classical / Religious / Historical movie / Drama')).toBe('movie')
    expect(en('Soap / Melodrama / Folklore')).toBe('series')
    expect(en('News / Current affairs')).toBe('news')
    expect(en('Show / Game show')).toBe('entertainment')
    expect(en("Children's / Youth programs")).toBe('kids')
    expect(en('Music / Ballet / Dance')).toBe('music')
    expect(en('Arts / Culture (without music)')).toBe('documentary')
    expect(en('Social / Political issues / Economics')).toBe('news')
    expect(en('Education / Science / Factual topics')).toBe('documentary')
    expect(en('Leisure hobbies')).toBe('entertainment')
  })

  test("a category's language picks its table; without one, both", () => {
    expect(categoryKindOf({ lang: 'fr', text: 'Movie' })).toBeUndefined()
    expect(categoryKindOf({ lang: 'en', text: 'Téléfilm' })).toBeUndefined()
    expect(categoryKindOf({ text: 'Documentaire' })).toBe('documentary')
    expect(categoryKindOf({ lang: 'de', text: 'Movie' })).toBe('movie')
    expect(categoryKindOf({ lang: 'fr-FR', text: 'Sport' })).toBe('sport')
  })

  test("the first category that names a kind, else the channel's kind", () => {
    expect(
      programmeKindOf(
        [
          { lang: 'fr', text: 'Inclassable' },
          { lang: 'fr', text: 'Film' },
          { lang: 'en', text: 'Comedy' },
        ],
        'other',
      ),
    ).toBe('movie')
    expect(programmeKindOf([{ text: 'Inclassable' }], 'sport')).toBe('sport')
    expect(programmeKindOf([], 'other')).toBe('other')
  })

  test("a channel's kind: its group's words, then its name's, also at a word's end", () => {
    expect(channelKindOf({ group: 'FR | SPORTS', name: 'Canal+' })).toBe('sport')
    expect(channelKindOf({ group: 'News', name: 'TF1' })).toBe('news')
    expect(channelKindOf({ group: '|FR| CINÉMA', name: 'X' })).toBe('movie')
    expect(channelKindOf({ group: 'FR | ENFANTS', name: 'X' })).toBe('kids')
    expect(channelKindOf({ group: 'UK | DOCUMENTARIES', name: 'X' })).toBe('documentary')
    expect(channelKindOf({ group: 'FR | GENERAL', name: 'Eurosport 1' })).toBe('sport')
    expect(channelKindOf({ group: 'Freebox TV', name: 'franceinfo:' })).toBe('news')
    expect(channelKindOf({ group: '', name: 'Euronews' })).toBe('news')
    expect(channelKindOf({ group: '', name: 'Ciné+ Frisson' })).toBe('movie')
    expect(channelKindOf({ group: '', name: 'Kids One' })).toBe('kids')
    expect(channelKindOf({ group: '', name: 'Musique Hits' })).toBe('music')
    expect(channelKindOf({ group: '', name: 'Série Club' })).toBe('series')
    expect(channelKindOf({ group: 'FR | GENERAL', name: 'TF1 HD' })).toBe('other')
    expect(channelKindOf({ group: '', name: 'France 2' })).toBe('other')
  })
})
