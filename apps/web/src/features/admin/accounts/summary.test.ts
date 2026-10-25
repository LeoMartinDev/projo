import { describe, expect, test } from 'bun:test'

import { profileSummary, type SummaryLabels } from './summary.ts'

const labels: SummaryLabels = {
  allLibraries: 'Toutes les bibliothèques',
  noLibrary: 'Aucune bibliothèque',
  noLimit: 'sans limite',
  rating: (tier) => (tier === '0' ? 'Tous publics' : `${tier} ans et plus`),
  pin: 'code PIN',
}

const libraries = [
  { id: 'l1', name: 'Films' },
  { id: 'l2', name: 'Séries' },
  { id: 'l3', name: 'Animation' },
]

describe('profileSummary', () => {
  test('all libraries, no limit', () => {
    expect(
      profileSummary({ libraryAccess: 'all', libraryIds: [], hasPin: false }, libraries, labels),
    ).toBe('Toutes les bibliothèques · sans limite')
  })

  test('selected libraries in library order, rating tier and PIN', () => {
    expect(
      profileSummary(
        {
          libraryAccess: 'selected',
          libraryIds: ['l2', 'l1'],
          maxContentRating: '16',
          hasPin: true,
        },
        libraries,
        labels,
      ),
    ).toBe('Films, Séries · 16 ans et plus · code PIN')
  })

  test('selected access without any library left', () => {
    expect(
      profileSummary(
        { libraryAccess: 'selected', libraryIds: ['gone'], maxContentRating: '0', hasPin: false },
        libraries,
        labels,
      ),
    ).toBe('Aucune bibliothèque · Tous publics')
  })
})
