import { appError, type AppError, err, ok, type Result } from '@projo/shared'

import {
  type CatalogItem,
  type CatalogReadModel,
  isPlayableKind,
  type ItemPerson,
  type MediaSummary,
  type PlayableSource,
  type PlayableSources,
  type VisibilityScope,
} from '../../core/catalog/catalog.ts'
import { regularEpisodes } from '../../core/progress/rows.ts'
import type { CatalogEntries, CatalogEntry } from './catalog-entries.ts'
import type { PlayButton, SeriesPlay } from './series-play.ts'

export type ItemDetail = CatalogEntry & {
  sources: PlayableSource[]
  series?: CatalogItem
  season?: CatalogItem
  people: ItemPerson[]
  media: MediaSummary
  play?: PlayButton
  firstEpisodeId?: string
}

type Deps = {
  catalogReadModel: Pick<
    CatalogReadModel,
    'findVisible' | 'listPeople' | 'describeMedia' | 'listSeriesEpisodes'
  >
  playableSources: Pick<PlayableSources, 'listReadySources'>
  catalogEntries: CatalogEntries
  seriesPlay: SeriesPlay
}

export type GetItemError = AppError<'item/not_found'>

export const getItemFactory =
  ({ catalogReadModel, playableSources, catalogEntries, seriesPlay }: Deps) =>
  async ({
    id,
    profileId,
    scope,
  }: {
    id: string
    profileId: string
    scope: VisibilityScope
  }): Promise<Result<ItemDetail, GetItemError>> => {
    const item = catalogReadModel.findVisible({ id, scope })
    if (item === undefined) {
      return err(appError('item/not_found', 'item not found', { context: { itemId: id } }))
    }
    const parent =
      item.parentId === undefined
        ? undefined
        : catalogReadModel.findVisible({ id: item.parentId, scope })
    const grandParent =
      parent?.parentId === undefined
        ? undefined
        : catalogReadModel.findVisible({ id: parent.parentId, scope })
    const season = item.kind === 'episode' && parent?.kind === 'season' ? parent : undefined
    const series =
      parent?.kind === 'series' ? parent : grandParent?.kind === 'series' ? grandParent : undefined

    const ownPeople = catalogReadModel.listPeople(item.id)
    const people =
      ownPeople.length === 0 && series !== undefined
        ? catalogReadModel.listPeople(series.id)
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
            catalogReadModel
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
        ? playableSources.listReadySources({ itemId: item.id, scope })
        : [],
      people,
      media: catalogReadModel.describeMedia({ itemId: item.id, scope }),
      ...(series === undefined ? {} : { series }),
      ...(season === undefined ? {} : { season }),
      ...(play === undefined ? {} : { play }),
      ...(firstEpisode === undefined ? {} : { firstEpisodeId: firstEpisode.id }),
    })
  }

export type GetItem = ReturnType<typeof getItemFactory>
