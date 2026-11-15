import type { GenreId } from '@projo/shared/api/genres'
import type { ItemMetadataDto, UpdateItemMetadataBody } from '@projo/shared/api/metadata'

export type MetadataForm = { title: string; year: string; overview: string; genres: GenreId[] }

export const formOf = (item: ItemMetadataDto): MetadataForm => ({
  title: item.title ?? '',
  year: item.year === undefined ? '' : String(item.year),
  overview: item.overview ?? '',
  genres: [...item.genres],
})

export const toggleGenre = (genres: readonly GenreId[], genre: GenreId): GenreId[] =>
  genres.includes(genre) ? genres.filter((other) => other !== genre) : [...genres, genre]

export type FormProblem = 'title' | 'year'

const YEAR = /^\d{4}$/u

export const changesOf = (
  form: MetadataForm,
  item: ItemMetadataDto,
): { body?: UpdateItemMetadataBody; problems: FormProblem[] } => {
  const problems: FormProblem[] = []
  const body: UpdateItemMetadataBody = {}
  const title = form.title.trim()
  if (title === '') {
    if (item.title !== undefined) problems.push('title')
  } else if (title !== item.title) body.title = title

  const yearText = form.year.trim()
  if (yearText !== '') {
    const year = Number(yearText)
    if (!YEAR.test(yearText) || year < 1870 || year > 2200) problems.push('year')
    else if (year !== item.year) body.year = year
  }

  const overview = form.overview.trim()
  if (overview !== (item.overview ?? '')) body.overview = overview

  if (form.genres.join('\n') !== item.genres.join('\n')) body.genres = [...form.genres]

  return Object.keys(body).length === 0 ? { problems } : { body, problems }
}
