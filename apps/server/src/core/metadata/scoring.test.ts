import { describe, expect, test } from 'bun:test'

import { pickBest, scoreCandidate, titleSimilarity, yearTerm } from './scoring.ts'
import type { TmdbSearchHit } from './tmdb.ts'

const hit = (
  tmdbId: number,
  title: string,
  year: number | undefined,
  popularity = 10,
  originalTitle?: string,
  voteCount = 100,
): TmdbSearchHit => ({
  tmdbId,
  title,
  popularity,
  voteCount,
  ...(year === undefined ? {} : { year }),
  ...(originalTitle === undefined ? {} : { originalTitle }),
})

describe('titleSimilarity', () => {
  test('ignores case, accents and punctuation', () => {
    expect(
      titleSimilarity("Le Fabuleux Destin d'Amélie Poulain", 'le fabuleux destin damelie poulain'),
    ).toBe(1)
    expect(titleSimilarity('Spider-Man: No Way Home', 'Spider Man No Way Home')).toBe(1)
  })
  test('word order does not matter much', () => {
    expect(titleSimilarity('Office, The', 'The Office')).toBe(1)
  })
  test('unrelated titles are far apart', () => {
    expect(titleSimilarity('Inception', 'Interstellar')).toBeLessThan(0.6)
  })
})

describe('yearTerm', () => {
  test('exact year bonus, ±1 small malus, otherwise a large one', () => {
    expect(yearTerm(2010, 2010)).toBeGreaterThan(0)
    expect(yearTerm(2002, 2001)).toBeLessThan(0)
    expect(yearTerm(2002, 2001)).toBeGreaterThan(yearTerm(2002, 1990))
    expect(yearTerm(undefined, 1990)).toBe(0)
    expect(yearTerm(2010, undefined)).toBeLessThan(0)
  })
})

describe('pickBest (§9.2)', () => {
  test('a French title matches the localized TMDB title', () => {
    const outcome = pickBest({ title: "Le Fabuleux Destin d'Amélie Poulain", year: 2001 }, [
      hit(
        194,
        "Le Fabuleux Destin d'Amélie Poulain",
        2001,
        38,
        "Le Fabuleux Destin d'Amélie Poulain",
      ),
    ])
    expect(outcome).toMatchObject({ kind: 'accepted', hit: { tmdbId: 194 } })
  })

  test('an English file name in a French library matches through original_title', () => {
    const outcome = pickBest({ title: 'The Dark Knight', year: 2008 }, [
      hit(155, 'The Dark Knight : Le Chevalier noir', 2008, 90, 'The Dark Knight'),
      hit(272, 'Batman Begins', 2005, 60, 'Batman Begins'),
    ])
    expect(outcome).toMatchObject({ kind: 'accepted', hit: { tmdbId: 155 } })
  })

  test('a year off by one is still accepted', () => {
    const outcome = pickBest({ title: 'Amélie', year: 2002 }, [hit(194, 'Amélie', 2001, 38)])
    expect(outcome).toMatchObject({ kind: 'accepted', hit: { tmdbId: 194 } })
  })

  test('homonyms: the year decides', () => {
    const candidates = [hit(438631, 'Dune', 2021, 101), hit(841, 'Dune', 1984, 31)]
    expect(pickBest({ title: 'Dune', year: 1984 }, candidates)).toMatchObject({
      kind: 'accepted',
      hit: { tmdbId: 841 },
    })
    expect(pickBest({ title: 'Dune', year: 2021 }, candidates)).toMatchObject({
      kind: 'accepted',
      hit: { tmdbId: 438631 },
    })
  })

  test('homonyms without a year are ambiguous', () => {
    const outcome = pickBest({ title: 'Dune' }, [
      hit(438631, 'Dune', 2021, 101),
      hit(841, 'Dune', 1984, 31),
    ])
    expect(outcome.kind).toBe('ambiguous_match')
  })

  test('without a year, a clear single title is accepted (stricter threshold)', () => {
    const outcome = pickBest({ title: 'Inception' }, [
      hit(27205, 'Inception', 2010, 84),
      hit(64956, 'Inception: The Cobol Job', 2010, 4),
    ])
    expect(outcome).toMatchObject({ kind: 'accepted', hit: { tmdbId: 27205 } })
  })

  test('without a year, a near title is not enough', () => {
    expect(pickBest({ title: 'Inceptionist' }, [hit(27205, 'Inception', 2010, 84)]).kind).toBe(
      'no_match',
    )
    // The same title with the right year passes the lower threshold.
    expect(
      pickBest({ title: 'Inceptionist', year: 2010 }, [hit(27205, 'Inception', 2010, 84)]).kind,
    ).toBe('accepted')
    // A one-letter typo is fine even without a year.
    expect(pickBest({ title: 'Incepton' }, [hit(27205, 'Inception', 2010, 84)]).kind).toBe(
      'accepted',
    )
  })

  test('series with a year in the folder name', () => {
    const outcome = pickBest({ title: 'Doctor Who', year: 2005 }, [
      hit(57243, 'Doctor Who', 2005, 120),
      hit(121, 'Doctor Who', 1963, 60),
    ])
    expect(outcome).toMatchObject({ kind: 'accepted', hit: { tmdbId: 57243 } })
  })

  test('a very popular title beats an obscure homonym', () => {
    const outcome = pickBest({ title: 'Fleabag' }, [
      hit(67070, 'Fleabag', 2016, 120),
      hit(999001, 'Fleabag', 2019, 0.6),
    ])
    expect(outcome).toMatchObject({ kind: 'accepted', hit: { tmdbId: 67070 } })
  })

  test('a saga prefix matches through an alternative title', () => {
    const query = { title: 'Star Wars Episode VI Return of the Jedi', year: 1983 }
    const jedi = hit(1892, 'Le Retour du Jedi', 1983, 20, 'Return of the Jedi')
    expect(pickBest(query, [jedi]).kind).toBe('no_match')
    expect(
      pickBest(query, [
        {
          ...jedi,
          alternativeTitles: ['Blue Harvest', 'Star Wars: Episode VI - Return of the Jedi'],
        },
      ]),
    ).toMatchObject({ kind: 'accepted', hit: { tmdbId: 1892 } })
  })

  test('homonyms without a year: far more votes settle it (§9.2)', () => {
    const candidates = [
      hit(91363, 'What If...?', 2021, 54, 'What If...?', 4755),
      hit(81940, 'WHAT / IF', 2019, 9, 'WHAT / IF', 187),
      hit(155386, 'What If?', 2019, 1.9, 'ماذا لو؟', 0),
    ]
    expect(pickBest({ title: 'What If' }, candidates)).toMatchObject({
      kind: 'accepted',
      hit: { tmdbId: 91363 },
    })
    // Two well-known homonyms stay a human decision.
    expect(
      pickBest({ title: 'What If' }, [
        hit(91363, 'What If...?', 2021, 54, undefined, 4755),
        hit(81940, 'WHAT / IF', 2019, 9, undefined, 1200),
      ]).kind,
    ).toBe('ambiguous_match')
    // A handful of votes against none proves nothing.
    expect(
      pickBest({ title: 'What If' }, [
        hit(208452, 'What If', 2022, 0.7, undefined, 12),
        hit(203255, 'What If', 2018, 0.9, undefined, 0),
      ]).kind,
    ).toBe('ambiguous_match')
  })

  test('votes never lift a weaker title over a closer one', () => {
    const outcome = pickBest({ title: 'Mission Impossible' }, [
      hit(1, 'Mission Impossible', 1996, 1, undefined, 20),
      hit(2, 'Mission Impossibles', 2021, 101, undefined, 9000),
    ])
    expect(outcome.kind).toBe('ambiguous_match')
  })

  test('a year off: the exact title with far more votes beats obscure exact years (Split)', () => {
    const obscure = [
      hit(425636, 'Split', 2016, 1.3, 'Split', 8),
      hit(358364, 'Split', 2016, 1.1, 'Split', 57),
      hit(409583, 'Split', 2016, 1.1, 'Split', 26),
    ]
    const shyamalan = hit(381288, 'Split', 2017, 20, 'Split', 18767)
    expect(pickBest({ title: 'Split', year: 2016 }, [...obscure, shyamalan])).toMatchObject({
      kind: 'accepted',
      hit: { tmdbId: 381288 },
    })
    // A single obscure exact year would have been accepted on its own: the favorite still wins.
    expect(pickBest({ title: 'Split', year: 2016 }, [obscure[1]!, shyamalan])).toMatchObject({
      kind: 'accepted',
      hit: { tmdbId: 381288 },
    })
  })

  test('a year off without far more votes: the exact year keeps the lead', () => {
    expect(
      pickBest({ title: 'Split', year: 2016 }, [
        hit(1, 'Split', 2016, 5, 'Split', 2000),
        hit(2, 'Split', 2017, 20, 'Split', 18767),
      ]),
    ).toMatchObject({ kind: 'accepted', hit: { tmdbId: 1 } })
    // Two years off is another film.
    expect(
      pickBest({ title: 'Split', year: 2016 }, [
        hit(1, 'Split', 2016, 1, 'Split', 8),
        hit(2, 'Split', 2018, 20, 'Split', 18767),
      ]),
    ).toMatchObject({ kind: 'accepted', hit: { tmdbId: 1 } })
  })

  test('nothing, or nothing close: no_match', () => {
    expect(pickBest({ title: 'Inception' }, []).kind).toBe('no_match')
    expect(pickBest({ title: 'Inception', year: 2010 }, [hit(1, 'Titanic', 1997, 90)]).kind).toBe(
      'no_match',
    )
  })

  test('the same candidate from several searches counts once', () => {
    const inception = hit(27205, 'Inception', 2010, 84)
    expect(pickBest({ title: 'Inception' }, [inception, inception]).kind).toBe('accepted')
  })

  test('scores rank exact title + year first', () => {
    const query = { title: 'Dune', year: 2021 }
    expect(scoreCandidate(query, hit(1, 'Dune', 2021))).toBeGreaterThan(
      scoreCandidate(query, hit(2, 'Dune: Part Two', 2024)),
    )
  })
})
