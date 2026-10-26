import type { TFunction } from 'i18next'

import { editionLabel } from '@projo/i18n/versions'
import type { SourceDto } from '@projo/shared/api/libraries'
import { type ReviewReason, reviewReasonSchema } from '@projo/shared/api/metadata'

import type { IdentifyInitial } from '../identify/IdentifyForm.tsx'

/** Last segment of a relative path: what the admin recognizes first. */
export const fileName = (relativePath: string): string =>
  relativePath.split(/[\\/]/u).findLast((part) => part.length > 0) ?? relativePath

const pad = (value: number) => String(value).padStart(2, '0')

/** `S01E03`, `S01E03-E04`, `E03` (no season): the scene notation, the same in every language. */
export const sceneCode = (
  season: number | undefined,
  episode: number | undefined,
  episodeEnd?: number,
): string | undefined => {
  if (episode === undefined) return season === undefined ? undefined : `S${pad(season)}`
  const range = episodeEnd !== undefined && episodeEnd > episode ? `-E${pad(episodeEnd)}` : ''
  return `${season === undefined ? '' : `S${pad(season)}`}E${pad(episode)}${range}`
}

/**
 * What the parser understood of the path (§15 "To review"), in one line: `Inception · 2010`,
 * `The Office · S02E03 · 2005`, `One Piece · #1015`, `Daily Show · 2024-03-01`; the edition in
 * the interface language (`Blade Runner · 1982 · Version longue`).
 */
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

/** Known §7.8 reason, or `undefined` for a code this web build does not know. */
export const reviewReason = (value: string | undefined): ReviewReason | undefined => {
  const parsed = reviewReasonSchema.safeParse(value)
  return parsed.success ? parsed.data : undefined
}

/** The identification form, prefilled from the parse: series + season + episode, or title + year. */
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
