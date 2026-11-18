import type { TFunction } from 'i18next'

import type { TvEpisodeDto, TvProgrammeDto } from '@projo/shared/api/tv'

/** A programme's episode (§29.6): `S2 E5`, `Season 2`, `Episode 5`, else its on-screen text. */
export const episodeLabel = (
  t: TFunction,
  episode: TvEpisodeDto | undefined,
): string | undefined => {
  if (episode === undefined) return undefined
  const { season, episode: number, label } = episode
  if (season !== undefined && number !== undefined)
    return t('tv.episode', { season, episode: number })
  if (season !== undefined) return t('tv.seasonOnly', { season })
  if (number !== undefined) return t('tv.episodeOnly', { episode: number })
  return label
}

/** The episode and subtitle on one line (`S2 E5 · Robin`); `undefined` when it has neither. */
export const episodeLine = (
  t: TFunction,
  programme: Pick<TvProgrammeDto, 'episode' | 'subtitle'>,
): string | undefined => {
  const parts = [episodeLabel(t, programme.episode), programme.subtitle].filter(
    (part): part is string => part !== undefined && part !== '',
  )
  return parts.length === 0 ? undefined : parts.join(' · ')
}
