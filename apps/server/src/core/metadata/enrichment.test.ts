import { describe, expect, test } from 'bun:test'

import {
  chooseImages,
  episodeMetadata,
  episodeNeedsFallback,
  mergeEpisodeFallback,
  mergeFallback,
  movieMetadata,
  needsFallback,
  seasonMetadata,
  selectPeople,
  seriesStatusOf,
  withoutLocked,
} from './enrichment.ts'
import type { TmdbImage, TmdbMovie, TmdbSeries } from './tmdb.ts'

/** `undefined` in `overrides` removes the property (TMDB had no value). */
const movie = (overrides: { [K in keyof TmdbMovie]?: TmdbMovie[K] | undefined } = {}): TmdbMovie =>
  Object.fromEntries(
    Object.entries({ ...base, ...overrides }).filter(([, value]) => value !== undefined),
  ) as TmdbMovie

const base: TmdbMovie = {
  tmdbId: 1,
  title: 'Inception',
  originalTitle: 'Inception',
  overview: 'Dom Cobb…',
  releaseDate: '2010-07-15',
  runtimeMinutes: 148,
  genres: ['action'],
  originalLanguage: 'en',
  voteAverage: 8.4,
  images: { posters: [], backdrops: [], logos: [] },
  credits: { cast: [], crew: [] },
  ratings: [{ country: 'US', rating: 'PG-13', type: 3 }],
}

describe('movieMetadata', () => {
  test('maps the TMDB fields; rating of the library country with US fallback', () => {
    expect(movieMetadata(movie(), 'FR')).toMatchObject({
      title: 'Inception',
      year: 2010,
      runtimeMinutes: 148,
      contentRating: 'PG-13',
      contentRatingCountry: 'US',
      genres: ['action'],
    })
    expect(
      movieMetadata(
        movie({ ratings: [...movie().ratings, { country: 'FR', rating: '12', type: 3 }] }),
        'FR',
      ),
    ).toMatchObject({ contentRating: '12', contentRatingCountry: 'FR' })
  })
})

describe('locks (§9.3)', () => {
  test('a locked field is absent from the patch, the others clear when TMDB lost them', () => {
    const patch = withoutLocked(
      movieMetadata(movie({ overview: '' }), 'FR'),
      new Set(['title', 'genres']),
    )
    expect('title' in patch).toBe(false)
    expect('genres' in patch).toBe(false)
    expect('overview' in patch).toBe(true)
    expect(patch.overview).toBeUndefined()
    expect(patch.year).toBe(2010)
  })
  test('image locks do not touch the columns', () => {
    const patch = withoutLocked(movieMetadata(movie(), 'FR'), new Set(['poster_image_id']))
    expect(patch.title).toBe('Inception')
  })
})

describe('en-US fallback, field by field (§9.1)', () => {
  test('an empty overview asks for the fallback, the title stays', () => {
    const fr = movie({
      overview: undefined,
      title: 'Le Voyage de Chihiro',
      originalTitle: '千と千尋の神隠し',
      originalLanguage: 'ja',
    })
    expect(needsFallback(fr, 'fr-FR')).toBe(true)
    const merged = mergeFallback(fr, { title: 'Spirited Away', overview: 'A girl…' }, 'fr-FR')
    expect(merged).toMatchObject({ title: 'Le Voyage de Chihiro', overview: 'A girl…' })
  })
  test('an untranslated title (original language, not English) takes the English one', () => {
    const fr = movie({
      title: '千と千尋の神隠し',
      originalTitle: '千と千尋の神隠し',
      originalLanguage: 'ja',
    })
    expect(needsFallback(fr, 'fr-FR')).toBe(true)
    expect(mergeFallback(fr, { title: 'Spirited Away' }, 'fr-FR').title).toBe('Spirited Away')
  })
  test('an English original title is not a missing translation; English needs nothing', () => {
    expect(needsFallback(movie(), 'fr-FR')).toBe(false)
    expect(needsFallback(movie({ overview: undefined }), 'en-US')).toBe(false)
  })
  test('episodes: generic names and empty overviews are completed', () => {
    const episode = { tmdbId: 1, seasonNumber: 1, episodeNumber: 2, name: 'Épisode 2' }
    expect(episodeNeedsFallback(episode, 'fr-FR')).toBe(true)
    expect(
      mergeEpisodeFallback(episode, { ...episode, name: 'Hands', overview: 'Inspection.' }),
    ).toMatchObject({ name: 'Hands', overview: 'Inspection.' })
    const named = { ...episode, name: 'Système', overview: 'Carmy…' }
    expect(episodeNeedsFallback(named, 'fr-FR')).toBe(false)
  })
})

describe('season and episode titles (§6.3)', () => {
  const inherited = { genres: [] }
  const episode = (name: string | undefined) => ({
    tmdbId: 1,
    seasonNumber: 1,
    episodeNumber: 7,
    ...(name === undefined ? {} : { name }),
  })
  const season = (seasonNumber: number, name: string | undefined) => ({
    tmdbId: 2,
    seasonNumber,
    episodes: [],
    ...(name === undefined ? {} : { name }),
  })

  test('a generic or missing name leaves the title absent', () => {
    for (const name of ['Episode 7', 'Épisode 7', '', undefined]) {
      expect(episodeMetadata(episode(name), inherited).title).toBeUndefined()
    }
    expect(seasonMetadata(season(1, 'Saison 1'), inherited).title).toBeUndefined()
    expect(seasonMetadata(season(2, 'Season 2'), inherited).title).toBeUndefined()
    expect(seasonMetadata(season(0, 'Épisodes spéciaux'), inherited).title).toBeUndefined()
    expect(seasonMetadata(season(0, 'Specials'), inherited).title).toBeUndefined()
    expect(seasonMetadata(season(3, undefined), inherited).title).toBeUndefined()
  })

  test('real names are kept', () => {
    expect(episodeMetadata(episode('The Watcher'), inherited).title).toBe('The Watcher')
    expect(seasonMetadata(season(1, 'Book One: Water'), inherited).title).toBe('Book One: Water')
  })

  test('an absent title clears the column (not a lockable value left behind)', () => {
    const patch = withoutLocked(episodeMetadata(episode('Episode 7'), inherited), new Set())
    expect('title' in patch).toBe(true)
    expect(patch.title).toBeUndefined()
  })
})

describe('series status', () => {
  const series = (status: string, inProduction = false) =>
    ({ status, inProduction }) as unknown as TmdbSeries
  test('maps TMDB statuses', () => {
    expect(seriesStatusOf(series('Returning Series'))).toBe('in_production')
    expect(seriesStatusOf(series('Ended'))).toBe('ended')
    expect(seriesStatusOf(series('Ended', true))).toBe('in_production')
    expect(seriesStatusOf(series('Canceled'))).toBe('canceled')
  })
})

describe('selectPeople', () => {
  test('20 actors by order, directors and writers, one row per person and role', () => {
    const cast = Array.from({ length: 25 }, (_, i) => ({
      tmdbId: 100 + i,
      name: `Actor ${i}`,
      order: 24 - i,
      character: `Role ${i}`,
    }))
    const people = selectPeople(
      {
        cast,
        crew: [
          { tmdbId: 1, name: 'Nolan', job: 'Director', department: 'Directing' },
          { tmdbId: 1, name: 'Nolan', job: 'Screenplay', department: 'Writing' },
          { tmdbId: 1, name: 'Nolan', job: 'Writer', department: 'Writing' },
          { tmdbId: 2, name: 'Thomas', job: 'Producer', department: 'Production' },
        ],
      },
      [{ tmdbId: 3, name: 'Creator' }],
    )
    const actors = people.filter((p) => p.role === 'cast')
    expect(actors).toHaveLength(20)
    expect(actors[0]).toMatchObject({ name: 'Actor 24', order: 0 })
    expect(people.filter((p) => p.role === 'director').map((p) => p.name)).toEqual(['Nolan'])
    expect(people.filter((p) => p.role === 'writer').map((p) => [p.name, p.order])).toEqual([
      ['Creator', 0],
      ['Nolan', 1],
    ])
  })
})

describe('chooseImages', () => {
  const image = (path: string, language: string | undefined, voteAverage = 5): TmdbImage => ({
    path,
    width: 2000,
    height: 3000,
    voteAverage,
    ...(language === undefined ? {} : { language }),
  })
  test('poster in the language, textless backdrop, PNG logo only', () => {
    const choices = chooseImages(
      {
        posters: [
          image('/en.jpg', 'en', 9),
          image('/fr.jpg', 'fr', 4),
          image('/none.jpg', undefined),
        ],
        backdrops: [
          { ...image('/b-en.jpg', 'en', 9), width: 3840, height: 2160 },
          { ...image('/b-none.jpg', undefined, 2), width: 3840, height: 2160 },
        ],
        logos: [image('/logo.svg', 'fr', 9), image('/logo-en.png', 'en', 3)],
      },
      'fr-FR',
      {},
    )
    expect(choices.map((c) => [c.slot, c.path, c.size, c.width, c.height])).toEqual([
      ['poster', '/fr.jpg', 'w500', 500, 750],
      ['backdrop', '/b-none.jpg', 'w1280', 1280, 720],
      ['logo', '/logo-en.png', 'w500', 500, 750],
    ])
  })
  test('without an image list, the paths of the details', () => {
    expect(
      chooseImages({ posters: [], backdrops: [], logos: [] }, 'fr-FR', {
        posterPath: '/p.jpg',
        backdropPath: '/b.jpg',
      }).map((c) => [c.slot, c.path, c.width, c.height]),
    ).toEqual([
      ['poster', '/p.jpg', 500, 750],
      ['backdrop', '/b.jpg', 1280, 720],
    ])
  })
})
