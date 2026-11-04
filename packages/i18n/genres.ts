import type { TFunction } from 'i18next'

import type { GenreId } from '@projo/shared/api/genres'
import type { HomeCategoryDto } from '@projo/shared/api/home'

export const genreLabel = (t: TFunction, genre: GenreId): string => t(`genres.${genre}`)

export const categoryTitle = (t: TFunction, category: HomeCategoryDto): string =>
  category.kind === 'anime' ? t('home.rows.anime') : genreLabel(t, category.genre)

export const genreLabels = (t: TFunction, genres: readonly GenreId[], max = genres.length) =>
  genres.slice(0, max).map((genre) => genreLabel(t, genre))

export const sortGenresByLabel = (
  t: TFunction,
  genres: readonly GenreId[],
  locale: string,
): GenreId[] => {
  const collator = new Intl.Collator(locale, { sensitivity: 'base' })
  return [...genres].sort((a, b) => collator.compare(genreLabel(t, a), genreLabel(t, b)))
}
