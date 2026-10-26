import type { TFunction } from 'i18next'

import type { GenreId } from '@projo/shared/api/genres'
import type { HomeCategoryDto } from '@projo/shared/api/home'

/** §9.1: the API sends genre ids; the label is the interface language's (`genres.<id>`). */
export const genreLabel = (t: TFunction, genre: GenreId): string => t(`genres.${genre}`)

/** Title of a §13.3 category row and of its page: "Animés", or the genre label. */
export const categoryTitle = (t: TFunction, category: HomeCategoryDto): string =>
  category.kind === 'anime' ? t('home.rows.anime') : genreLabel(t, category.genre)

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
