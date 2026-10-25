import { useQuery } from '@tanstack/react-query'

import type { ItemDetailDto, ItemSummaryDto } from '@projo/shared/api/catalog'

import { childrenQuery } from '../catalog/queries.ts'
import { type NextEpisode, nextEpisodeOf, nextInSeason, nextSeason } from './next-episode.ts'

/**
 * The episode after `item` (§10.7), read like the series page reads its seasons: the season's
 * episodes first, the seasons and the next season's episodes only when the season ends.
 */
export const useNextEpisode = (item: ItemDetailDto | undefined): NextEpisode<ItemSummaryDto> => {
  const episode = item?.kind === 'episode' ? item : undefined
  const seasonId = episode?.season?.id ?? episode?.parentId
  const seriesId = episode?.series?.id
  const episodes = useQuery({ ...childrenQuery(seasonId ?? ''), enabled: seasonId !== undefined })
  const lastOfSeason =
    episode !== undefined &&
    episodes.data !== undefined &&
    nextInSeason(episodes.data.items, episode.id) === undefined
  const seasons = useQuery({
    ...childrenQuery(seriesId ?? ''),
    enabled: lastOfSeason && seriesId !== undefined,
  })
  const following =
    seasons.data === undefined ? undefined : nextSeason(seasons.data.items, episode?.seasonNumber)
  const nextSeasonEpisodes = useQuery({
    ...childrenQuery(following?.id ?? ''),
    enabled: following !== undefined,
  })
  if (episode === undefined || seasonId === undefined) return { status: 'none' }
  return nextEpisodeOf({
    currentId: episode.id,
    seasonNumber: episode.seasonNumber,
    episodes: episodes.data?.items,
    seasons: seriesId === undefined ? [] : seasons.data?.items,
    nextSeasonEpisodes: nextSeasonEpisodes.data?.items,
  })
}
