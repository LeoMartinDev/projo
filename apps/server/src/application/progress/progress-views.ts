import {
  type CatalogItem,
  isPlayableKind,
  type VisibilityScope,
  type VisibleItems,
} from '../../core/catalog/catalog.ts'
import {
  aggregateWatchStatus,
  type ItemProgress,
  type ProgressRepository,
  type WatchStatus,
} from '../../core/progress/progress.ts'

export type ProgressView =
  { kind: 'playable'; progress?: ItemProgress } | { kind: 'aggregate'; status: WatchStatus }

type Deps = {
  visibleItems: Pick<VisibleItems, 'listVisibleEpisodeIds'>
  progressRepository: ProgressRepository
}

export type ProgressViews = (input: {
  profileId: string
  items: readonly CatalogItem[]
  scope: VisibilityScope
}) => Map<string, ProgressView>

export const progressViewsFactory =
  ({ visibleItems, progressRepository }: Deps): ProgressViews =>
  ({ profileId, items, scope }) => {
    const playableIds = items.filter((item) => isPlayableKind(item.kind)).map((item) => item.id)
    const containerIds = items.filter((item) => !isPlayableKind(item.kind)).map((item) => item.id)
    const episodes = visibleItems.listVisibleEpisodeIds({ ancestorIds: containerIds, scope })
    const progress = progressRepository.findMany({
      profileId,
      itemIds: [...playableIds, ...episodes.map((episode) => episode.episodeId)],
    })

    const views = new Map<string, ProgressView>()
    for (const id of playableIds) {
      const entry = progress.get(id)
      views.set(
        id,
        entry === undefined ? { kind: 'playable' } : { kind: 'playable', progress: entry },
      )
    }
    const byAncestor = new Map<string, (ItemProgress | undefined)[]>()
    for (const { episodeId, ancestorId } of episodes) {
      const list = byAncestor.get(ancestorId) ?? []
      list.push(progress.get(episodeId))
      byAncestor.set(ancestorId, list)
    }
    for (const id of containerIds) {
      views.set(id, { kind: 'aggregate', status: aggregateWatchStatus(byAncestor.get(id) ?? []) })
    }
    return views
  }
