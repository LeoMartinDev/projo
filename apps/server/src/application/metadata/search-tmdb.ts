import type { Result } from '@projo/shared'

import type { MetadataSettings } from '../../core/metadata/ports.ts'
import type { TmdbApi, TmdbError, TmdbSearchHit } from '../../core/metadata/tmdb.ts'

type Deps = {
  tmdb: Pick<TmdbApi, 'searchMovies' | 'searchSeries'>
  settings: Pick<MetadataSettings, 'language'>
}

export type SearchTmdbError = TmdbError

export const searchTmdbFactory =
  ({ tmdb, settings }: Deps) =>
  (input: {
    query: string
    kind: 'movie' | 'series'
    year?: number
    language?: string
  }): Promise<Result<TmdbSearchHit[], SearchTmdbError>> => {
    const language = input.language ?? settings.language()
    return input.kind === 'movie'
      ? tmdb.searchMovies({
          query: input.query,
          ...(input.year === undefined ? {} : { year: input.year }),
          language,
        })
      : tmdb.searchSeries({
          query: input.query,
          ...(input.year === undefined ? {} : { firstAirYear: input.year }),
          language,
        })
  }

export type SearchTmdb = ReturnType<typeof searchTmdbFactory>
