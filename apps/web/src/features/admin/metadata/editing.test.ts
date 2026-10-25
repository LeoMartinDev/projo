import { describe, expect, test } from 'bun:test'

import type { ItemMetadataDto } from '@projo/shared/api/metadata'

import { changesOf, formOf, toggleGenre } from './editing.ts'

const item: ItemMetadataDto = {
  id: 'movie',
  kind: 'movie',
  tmdbId: 27205,
  title: 'Inception',
  year: 2010,
  overview: 'Dom Cobb',
  genres: ['action', 'science_fiction'],
  images: {},
  locked: [],
}

describe('metadata editor form (§9.3)', () => {
  test('genres are picked from the list: a picked one goes last, picking again removes it', () => {
    expect(toggleGenre(['action', 'science_fiction'], 'drama')).toEqual([
      'action',
      'science_fiction',
      'drama',
    ])
    expect(toggleGenre(['action', 'science_fiction'], 'action')).toEqual(['science_fiction'])
    expect(toggleGenre([], 'western')).toEqual(['western'])
  })

  test('only the fields that changed are sent (each one gets locked)', () => {
    const form = formOf(item)
    expect(form).toEqual({
      title: 'Inception',
      year: '2010',
      overview: 'Dom Cobb',
      genres: ['action', 'science_fiction'],
    })
    expect(changesOf(form, item)).toEqual({ problems: [] })
    expect(changesOf({ ...form, title: ' Origine ' }, item)).toEqual({
      body: { title: 'Origine' },
      problems: [],
    })
    expect(changesOf({ ...form, year: '2011', overview: '', genres: ['drama'] }, item)).toEqual({
      body: { year: 2011, overview: '', genres: ['drama'] },
      problems: [],
    })
    // Same genres in another order: the order is what the cards show, so it is a change.
    expect(changesOf({ ...form, genres: ['science_fiction', 'action'] }, item).body).toEqual({
      genres: ['science_fiction', 'action'],
    })
    expect(changesOf({ ...form, genres: [] }, item).body).toEqual({ genres: [] })
  })

  test('an empty title or a wrong year is refused; a cleared year is no change', () => {
    const form = formOf(item)
    expect(changesOf({ ...form, title: '  ' }, item).problems).toEqual(['title'])
    expect(changesOf({ ...form, year: '99' }, item).problems).toEqual(['year'])
    expect(changesOf({ ...form, year: '1500' }, item).problems).toEqual(['year'])
    expect(changesOf({ ...form, year: '' }, item)).toEqual({ problems: [] })
  })

  test('an episode without a name of its own (§6.3): empty title, other fields still saved', () => {
    const { title: _, ...rest } = item
    const episode: ItemMetadataDto = { ...rest, id: 'e7', kind: 'episode', genres: [] }
    const form = formOf(episode)
    expect(form.title).toBe('')
    expect(changesOf({ ...form, overview: 'Uatu' }, episode)).toEqual({
      body: { overview: 'Uatu' },
      problems: [],
    })
    expect(changesOf({ ...form, title: 'The Watcher' }, episode).body).toEqual({
      title: 'The Watcher',
    })
  })
})
