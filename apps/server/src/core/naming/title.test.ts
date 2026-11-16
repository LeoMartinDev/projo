import { describe, expect, test } from 'bun:test'

import { extractIdTags, normalizeTitle, parseTitleFragment, prettifyTitle } from './title'

describe('normalizeTitle (comparaison, §9.2)', () => {
  test.each([
    ["Le Fabuleux Destin d'Amélie Poulain", 'le fabuleux destin damelie poulain'],
    ['Spider-Man: No Way Home', 'spider man no way home'],
    ['Fast & Furious', 'fast and furious'],
    ['  WALL·E  ', 'wall e'],
  ])('%s', (raw, expected) => {
    expect(normalizeTitle(raw)).toBe(expected)
  })
})

describe('prettifyTitle', () => {
  test.each([
    ['the.dark.knight', 'The Dark Knight'],
    ['THE DARK KNIGHT', 'The Dark Knight'],
    ['MASH', 'MASH'],
    ['S.W.A.T', 'S.W.A.T'],
    ['Mr. Robot', 'Mr. Robot'],
    ['Le_Samourai', 'Le Samourai'],
    ['Heat (', 'Heat'],
    ['Heat -', 'Heat'],
    ['GRP]', 'GRP'],
    ['The Office (US)', 'The Office (US)'],
    ['', ''],
  ])('%p → %p', (raw, expected) => {
    expect(prettifyTitle(raw)).toBe(expected)
  })
})

describe('extractIdTags', () => {
  test('plusieurs tags, le premier de chaque sorte gagne', () => {
    const { rest, ids } = extractIdTags('Film [tmdbid-1] [imdb-tt0000001] {tvdb-3} [tmdbid-2]')
    expect(rest.trim()).toBe('Film')
    expect(ids).toEqual({ tmdb: 1, imdb: 'tt0000001', tvdb: 3 })
  })

  test('sans tag', () => {
    expect(extractIdTags('Film')).toEqual({ rest: 'Film' })
  })

  test('valeurs invalides ignorées', () => {
    expect(extractIdTags('Film [tmdbid-0] [imdb-1234] [tvdb-x]').ids).toBeUndefined()
  })
})

describe('parseTitleFragment : plage d’années', () => {
  test.each([
    ['Dragon Ball Super 2015-2018 Intégral (131EP) TrueFrench 1080p HDLight BluRay AC3 x265-GRP'],
    ['Dragon Ball Super 2015 - 2018'],
    ['Dragon Ball Super 2015–2018'],
    ['Dragon Ball Super (2015-2018)'],
    ['Dragon Ball Super [2015-2018]'],
    ['Dragon.Ball.Super.2015-2018.MULTi.1080p'],
  ])('%s → titre seul, première année à part', (raw) => {
    expect(parseTitleFragment(raw)).toEqual({ title: 'Dragon Ball Super', rangeStart: 2015 })
  })

  test('une année et une plage : l’année reste l’année', () => {
    expect(parseTitleFragment('Show (2008) 2008-2013')).toEqual({
      title: 'Show',
      year: 2008,
      rangeStart: 2008,
    })
  })

  test('sans délimiteur ni contenu avant, pas une plage', () => {
    expect(parseTitleFragment('2015-2018')).toEqual({ title: '2015-2018' })
  })

  test('sans détection d’année (titre d’épisode), la plage reste', () => {
    expect(
      parseTitleFragment('Retour 2015-2018', { detectParts: false, detectYear: false }),
    ).toEqual({ title: 'Retour 2015-2018' })
  })
})

describe('parseTitleFragment : mots faibles en chaîne', () => {
  test.each([
    ['Name 131 épisodes', 'Name'],
    ['Name (131EP) FRENCH 1080p', 'Name'],
    ['Name 131 EP MULTi', 'Name'],
    ['Mob Psycho 100 FRENCH', 'Mob Psycho 100'],
    ['Show 12 EPIC', 'Show 12 EPIC'],
  ])('%s → %s', (raw, title) => {
    expect(parseTitleFragment(raw)).toEqual({ title })
  })
})

describe('parseTitleFragment : marqueurs d’intégrale (withoutMarkers)', () => {
  test.each([
    ['Name Intégrale (131EP) TrueFrench 1080p', 'Name Intégrale', 'Name'],
    ['Name INTÉGRALE 131 EP', 'Name INTÉGRALE', 'Name'],
    ['Name Integrale VOSTFR', 'Name Integrale', 'Name'],
    ['Name Complete 131 eps FRENCH 1080p', 'Name Complete', 'Name'],
    ['Name Complet [131 ep]', 'Name Complet', 'Name'],
    ['Name French Complète', 'Name French Complète', 'Name'],
    ['Mission.Complete', 'Mission Complete', 'Mission'],
    ['Les Visiteurs Intégrale', 'Les Visiteurs Intégrale', 'Les Visiteurs'],
    ['LES VISITEURS INTEGRALE', 'Les Visiteurs Integrale', 'Les Visiteurs'],
    ['Show Intégrale VOSTFR 1080p', 'Show Intégrale', 'Show'],
  ])('%s → %s, sans marqueur %s', (raw, title, withoutMarkers) => {
    expect(parseTitleFragment(raw)).toEqual({ title, withoutMarkers })
  })

  test('avec une année : le marqueur reste, l’année est lue', () => {
    expect(parseTitleFragment('Mission Complete (2019)')).toEqual({
      title: 'Mission Complete',
      withoutMarkers: 'Mission',
      year: 2019,
    })
  })

  test('une plage d’années coupe avant le marqueur : pas de withoutMarkers', () => {
    expect(
      parseTitleFragment('Dragon Ball Super 2015-2018 Intégral (131EP) TrueFrench 1080p'),
    ).toEqual({ title: 'Dragon Ball Super', rangeStart: 2015 })
  })

  test.each([
    'A Complete Unknown',
    'A.Complete.Unknown.2024.1080p',
    'Integral Calculus Explained',
    'Complete Works of Bach',
  ])('au milieu ou en tête du titre, rien ne change : %s', (raw) => {
    expect(parseTitleFragment(raw).withoutMarkers).toBeUndefined()
  })

  test('un titre fait du seul marqueur : pas de withoutMarkers vide', () => {
    expect(parseTitleFragment('Intégrale 1080p')).toEqual({ title: 'Intégrale' })
  })

  test('forme décomposée (NFD) normalisée avant lecture', () => {
    expect(parseTitleFragment('Name Intégrale 1080p'.normalize('NFD'))).toEqual({
      title: 'Name Intégrale',
      withoutMarkers: 'Name',
    })
  })
})
