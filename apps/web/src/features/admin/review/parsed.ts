import type { TFunction } from 'i18next'

import { editionLabel } from '@projo/i18n/versions'
import type { SourceDto } from '@projo/shared/api/libraries'
import { type ReviewReason, reviewReasonSchema } from '@projo/shared/api/metadata'

import type { IdentifyInitial } from '../identify/IdentifyForm.tsx'

export const fileName = (relativePath: string): string =>
  relativePath.split(/[\\/]/u).findLast((part) => part.length > 0) ?? relativePath

const pad = (value: number) => String(value).padStart(2, '0')

export const sceneCode = (
  season: number | undefined,
  episode: number | undefined,
  episodeEnd?: number,
): string | undefined => {
  if (episode === undefined) return season === undefined ? undefined : `S${pad(season)}`
  const range = episodeEnd !== undefined && episodeEnd > episode ? `-E${pad(episodeEnd)}` : ''
  return `${season === undefined ? '' : `S${pad(season)}`}E${pad(episode)}${range}`
}

export const parsedSummary = (
  t: TFunction,
  source: Pick<SourceDto, 'parsed' | 'displayTitle'>,
): string => {
  const { parsed } = source
  const name = parsed.series ?? parsed.title ?? source.displayTitle
  const code = sceneCode(parsed.season, parsed.episode, parsed.episodeEnd)
  return [
    name,
    code,
    code === undefined && parsed.absoluteEpisode !== undefined
      ? `#${parsed.absoluteEpisode}`
      : undefined,
    parsed.airDate,
    parsed.year === undefined ? undefined : String(parsed.year),
    editionLabel(t, parsed),
  ]
    .filter((part) => part !== undefined && part.length > 0)
    .join(' · ')
}

export const reviewReason = (value: string | undefined): ReviewReason | undefined => {
  const parsed = reviewReasonSchema.safeParse(value)
  return parsed.success ? parsed.data : undefined
}

export const initialFromSource = (
  source: Pick<SourceDto, 'parsed' | 'displayTitle' | 'classification'>,
): IdentifyInitial => {
  const { parsed } = source
  const isEpisode =
    source.classification === 'episode' ||
    (source.classification === 'unknown' && parsed.series !== undefined)
  const episode = parsed.episode ?? parsed.absoluteEpisode
  if (isEpisode) {
    return {
      mode: 'episode',
      query: parsed.series ?? parsed.title ?? source.displayTitle,
      ...(parsed.season === undefined ? {} : { season: parsed.season }),
      ...(episode === undefined ? {} : { episode }),
    }
  }
  return {
    mode: 'movie',
    query: parsed.title ?? source.displayTitle,
    ...(parsed.year === undefined ? {} : { year: parsed.year }),
  }
}
