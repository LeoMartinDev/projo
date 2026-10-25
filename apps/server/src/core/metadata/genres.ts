import type { GenreId } from '@projo/shared/api/genres'

/**
 * §9.1: TMDB genre ids → projo genre ids. Movies and series share the common TMDB ids; the
 * combined series genres are split (`10759` Action & Adventure → `action` + `adventure`…).
 */

const shared: Record<number, readonly GenreId[]> = {
  16: ['animation'],
  35: ['comedy'],
  80: ['crime'],
  99: ['documentary'],
  18: ['drama'],
  10751: ['family'],
  9648: ['mystery'],
  37: ['western'],
}

const movieGenres: Record<number, readonly GenreId[]> = {
  ...shared,
  28: ['action'],
  12: ['adventure'],
  14: ['fantasy'],
  36: ['history'],
  27: ['horror'],
  10402: ['music'],
  10749: ['romance'],
  878: ['science_fiction'],
  10770: ['tv_movie'],
  53: ['thriller'],
  10752: ['war'],
}

const seriesGenres: Record<number, readonly GenreId[]> = {
  ...shared,
  10759: ['action', 'adventure'],
  10762: ['kids'],
  10763: ['news'],
  10764: ['reality'],
  10765: ['science_fiction', 'fantasy'],
  10766: ['soap'],
  10767: ['talk'],
  10768: ['war', 'politics'],
}

export type TmdbGenreKind = 'movie' | 'series'

/**
 * The projo genres of TMDB genre ids, in TMDB order without duplicates; `unknown`: the TMDB ids
 * without a mapping (dropped, for the caller to log).
 */
export const tmdbGenres = (
  kind: TmdbGenreKind,
  tmdbIds: readonly number[],
): { genres: GenreId[]; unknown: number[] } => {
  const table = kind === 'movie' ? movieGenres : seriesGenres
  const genres = new Set<GenreId>()
  const unknown: number[] = []
  for (const tmdbId of tmdbIds) {
    const mapped = Object.hasOwn(table, tmdbId) ? table[tmdbId] : undefined
    if (mapped === undefined) unknown.push(tmdbId)
    else for (const genre of mapped) genres.add(genre)
  }
  return { genres: [...genres], unknown }
}
