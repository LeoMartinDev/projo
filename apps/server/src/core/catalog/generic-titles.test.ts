import { describe, expect, test } from 'bun:test'

import { chapterTitle, genericTitleNumber, ownTitle } from './generic-titles.ts'

describe('generic names', () => {
  test.each([
    ['Episode 7', 7],
    ['Épisode 7', 7],
    ['épisode 07', 7],
    ['EPISODE   12', 12],
    ['Episodio 3', 3],
    ['Folge 4', 4],
    ['Ep. 5', 5],
    ['Episode #8', 8],
    ['Épisode 9', 9],
  ])('episode %p → %p', (title, number) => {
    expect(genericTitleNumber('episode', title)).toBe(number)
  })

  test.each([
    ['Season 1', 1],
    ['Saison 2', 2],
    ['Saison 02', 2],
    ['Staffel 3', 3],
    ['Temporada 4', 4],
    ['Specials', 0],
    ['Épisodes spéciaux', 0],
    ['épisodes spéciaux', 0],
  ])('season %p → %p', (title, number) => {
    expect(genericTitleNumber('season', title)).toBe(number)
  })

  test.each([
    ['Chapter 01', 1],
    ['Chapter 34', 34],
    ['Chapitre 3', 3],
    ['chapitre 12', 12],
    ['Kapitel 2', 2],
    ['07', 7],
  ])('chapter %p → %p', (title, number) => {
    expect(genericTitleNumber('chapter', title)).toBe(number)
  })

  test.each([
    ['episode', 'Pilot'],
    ['episode', 'Episode 7: The Return'],
    ['episode', 'Chapter 9: The Marshal'],
    ['episode', 'Chapter 9'],
    ['episode', 'Seven'],
    ['season', 'Book One: Water'],
    ['season', 'Season 1 Part 2'],
    ['season', 'Episode 1'],
    ['chapter', 'Opening Credits'],
    ['chapter', 'Intro'],
    ['chapter', 'Chapter One'],
    ['chapter', 'Episode 2'],
  ] as const)('%s %p is a real name', (kind, title) => {
    expect(genericTitleNumber(kind, title)).toBeUndefined()
  })
})

describe('own title of an item', () => {
  test('generic name of its own number: absent', () => {
    expect(ownTitle({ kind: 'episode', title: 'Episode 7', episodeNumber: 7 })).toBeUndefined()
    expect(ownTitle({ kind: 'episode', title: 'Épisode 7', episodeNumber: 7 })).toBeUndefined()
    expect(ownTitle({ kind: 'season', title: 'Season 1', seasonNumber: 1 })).toBeUndefined()
    expect(ownTitle({ kind: 'season', title: 'Saison 1', seasonNumber: 1 })).toBeUndefined()
    expect(ownTitle({ kind: 'season', title: 'Specials', seasonNumber: 0 })).toBeUndefined()
    expect(
      ownTitle({ kind: 'season', title: 'Épisodes spéciaux', seasonNumber: 0 }),
    ).toBeUndefined()
  })

  test('empty: absent', () => {
    expect(ownTitle({ kind: 'episode', title: '', episodeNumber: 7 })).toBeUndefined()
    expect(ownTitle({ kind: 'season', title: '  ', seasonNumber: 1 })).toBeUndefined()
    expect(ownTitle({ kind: 'episode', title: undefined, episodeNumber: 7 })).toBeUndefined()
  })

  test('real names and other numbers are kept', () => {
    expect(ownTitle({ kind: 'episode', title: 'Pilot', episodeNumber: 1 })).toBe('Pilot')
    expect(ownTitle({ kind: 'episode', title: 'Episode 1050', episodeNumber: 5 })).toBe(
      'Episode 1050',
    )
    expect(ownTitle({ kind: 'season', title: 'Book One: Water', seasonNumber: 1 })).toBe(
      'Book One: Water',
    )
    expect(ownTitle({ kind: 'season', title: 'Specials', seasonNumber: 1 })).toBe('Specials')
  })

  test('without a number there is nothing to label from: kept', () => {
    expect(ownTitle({ kind: 'episode', title: 'Episode 7' })).toBe('Episode 7')
  })

  test('movies and series are never generic', () => {
    expect(ownTitle({ kind: 'movie', title: 'Episode 1' })).toBe('Episode 1')
    expect(ownTitle({ kind: 'series', title: 'Season 1', seasonNumber: 1 })).toBe('Season 1')
  })
})

describe('chapter titles', () => {
  test('muxer defaults are dropped', () => {
    expect(chapterTitle('Chapter 01')).toBeUndefined()
    expect(chapterTitle('Chapitre 3')).toBeUndefined()
    expect(chapterTitle('12')).toBeUndefined()
    expect(chapterTitle('')).toBeUndefined()
    expect(chapterTitle(undefined)).toBeUndefined()
  })

  test('real names are kept', () => {
    expect(chapterTitle('Opening Credits')).toBe('Opening Credits')
    expect(chapterTitle('Intro')).toBe('Intro')
  })
})
