import type { TFunction } from 'i18next'

import type { GenreId } from '@projo/shared/api/genres'

/** §9.1: the API sends genre ids; the label is the interface language's (`genres.<id>`). */
export const genreLabel = (t: TFunction, genre: GenreId): string => t(`genres.${genre}`)

/** Labels of the first `max` genres, in the item's order (TMDB order). */
export const genreLabels = (t: TFunction, genres: readonly GenreId[], max = genres.length) =>
  genres.slice(0, max).map((genre) => genreLabel(t, genre))

/** Genre ids sorted by label in `locale` (catalog filter, admin pick-list). */
export const sortGenresByLabel = (
  t: TFunction,
  genres: readonly GenreId[],
  locale: string,
): GenreId[] => {
  const collator = new Intl.Collator(locale, { sensitivity: 'base' })
  return [...genres].sort((a, b) => collator.compare(genreLabel(t, a), genreLabel(t, b)))
}
