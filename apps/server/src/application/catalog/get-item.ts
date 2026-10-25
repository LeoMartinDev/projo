import { appError, type AppError, err, ok, type Result } from '@projo/shared'

import {
  type CatalogItem,
  type CatalogRepository,
  type ItemPerson,
  isPlayableKind,
  type MediaSummary,
  type PlayableSource,
  type VisibilityScope,
} from '../../core/catalog/catalog.ts'
import { type CatalogEntries, type CatalogEntry, regularEpisodes } from './catalog-entries.ts'
import type { PlayButton, SeriesPlay } from './series-play.ts'

export type ItemDetail = CatalogEntry & {
  /** Ready sources of a movie or an episode (empty for seasons and series). */
  sources: PlayableSource[]
  series?: CatalogItem
  season?: CatalogItem
  people: ItemPerson[]
  media: MediaSummary
  /** Series and seasons: "Resume S2 · E4" / "Play". */
  play?: PlayButton
  /** Series and seasons: the first episode in broadcast order ("From the beginning", §13.5). */
  firstEpisodeId?: string
}

type Deps = {
  catalogRepository: CatalogRepository
  catalogEntries: CatalogEntries
  seriesPlay: SeriesPlay
}

export type GetItemError = AppError<'item/not_found'>

/**
 * `GET /items/:id` (§13.5): a visible item with its ready sources, ancestors, profile progress,
 * cast, best quality and languages, and for a series or a season the episode its button plays.
 * Cast: the item's, else (season, episode) the series'.
 */
export const getItemFactory =
  ({ catalogRepository, catalogEntries, seriesPlay }: Deps) =>
  async ({
    id,
    profileId,
    scope,
  }: {
    id: string
    profileId: string
    scope: VisibilityScope
  }): Promise<Result<ItemDetail, GetItemError>> => {
    const item = catalogRepository.findVisible({ id, scope })
    if (item === undefined) {
      return err(appError('item/not_found', 'item not found', { context: { itemId: id } }))
    }
    const parent =
      item.parentId === undefined
        ? undefined
        : catalogRepository.findVisible({ id: item.parentId, scope })
    const grandParent =
      parent?.parentId === undefined
        ? undefined
        : catalogRepository.findVisible({ id: parent.parentId, scope })
    const season = item.kind === 'episode' && parent?.kind === 'season' ? parent : undefined
    const series =
      parent?.kind === 'series' ? parent : grandParent?.kind === 'series' ? grandParent : undefined

    const ownPeople = catalogRepository.listPeople(item.id)
    const people =
      ownPeople.length === 0 && series !== undefined
        ? catalogRepository.listPeople(series.id)
        : ownPeople

    const seriesId =
      item.kind === 'series' ? item.id : item.kind === 'season' ? series?.id : undefined
    const play =
      seriesId === undefined
        ? undefined
        : seriesPlay({
            profileId,
            seriesId,
            scope,
            ...(item.kind === 'season' && item.seasonNumber !== undefined
              ? { seasonNumber: item.seasonNumber }
              : {}),
          })

    const firstEpisode =
      seriesId === undefined
        ? undefined
        : regularEpisodes(
            catalogRepository
              .listSeriesEpisodes({ seriesIds: [seriesId], scope })
              .filter(
                (episode) => item.kind !== 'season' || episode.seasonNumber === item.seasonNumber,
              ),
          )[0]

    const [entry] = catalogEntries({ profileId, items: [item], scope })
    if (entry === undefined) throw new Error(`no catalog entry for ${item.id}`)
    return ok({
      ...entry,
      sources: isPlayableKind(item.kind)
        ? catalogRepository.listReadySources({ itemId: item.id, scope })
        : [],
      people,
      media: catalogRepository.describeMedia({ itemId: item.id, scope }),
      ...(series === undefined ? {} : { series }),
      ...(season === undefined ? {} : { season }),
      ...(play === undefined ? {} : { play }),
      ...(firstEpisode === undefined ? {} : { firstEpisodeId: firstEpisode.id }),
    })
  }

export type GetItem = ReturnType<typeof getItemFactory>
