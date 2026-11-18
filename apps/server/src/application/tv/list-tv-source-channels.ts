import { type AppError, appError, err, ok, type Result } from '@projo/shared'

import { searchNameOf, type TvChannel, type TvChannelRepository } from '../../core/tv/channel.ts'
import type { TvGuideChannel, TvGuideChannelRepository } from '../../core/tv/guide.ts'
import type { TvSourceRepository } from '../../core/tv/source.ts'

type Deps = {
  tvSources: Pick<TvSourceRepository, 'findById'>
  tvChannels: Pick<TvChannelRepository, 'listChannels'>
  guideChannels: Pick<TvGuideChannelRepository, 'findMany'>
}

export type ListTvSourceChannelsError = AppError<'tv/source_not_found'>

/** `guideChannels`: the listed guide channels the items' guide channels name (§29.3), by lowercased id. */
export type TvChannelsPage = {
  items: TvChannel[]
  nextCursor?: string
  total: number
  guideChannels: ReadonlyMap<string, TvGuideChannel>
}

const offsetOf = (cursor: string | undefined): number => {
  const offset = cursor === undefined ? 0 : Number(cursor)
  return Number.isSafeInteger(offset) && offset > 0 ? offset : 0
}

/** A source's present channels for its dialog, in playlist order, searched and paged (§29.7). */
export const listTvSourceChannelsFactory =
  ({ tvSources, tvChannels, guideChannels }: Deps) =>
  ({
    sourceId,
    q,
    groupId,
    cursor,
    limit,
  }: {
    sourceId: string
    q?: string
    groupId?: string
    cursor?: string
    limit: number
  }): Result<TvChannelsPage, ListTvSourceChannelsError> => {
    if (tvSources.findById(sourceId) === undefined)
      return err(
        appError('tv/source_not_found', 'tv source not found', { context: { id: sourceId } }),
      )
    const offset = offsetOf(cursor)
    const search = q === undefined ? '' : searchNameOf(q.trim())
    const { items, total } = tvChannels.listChannels({
      sourceId,
      ...(search === '' ? {} : { search }),
      ...(groupId === undefined ? {} : { groupId }),
      offset,
      limit,
    })
    const next = offset + items.length
    const named = items.flatMap((channel) => {
      const id = channel.guideChannel ?? channel.guideMatched
      return id === undefined || id === '' ? [] : [id]
    })
    return ok({
      items,
      total,
      ...(next < total ? { nextCursor: String(next) } : {}),
      guideChannels:
        named.length === 0 ? new Map() : guideChannels.findMany({ sourceId, ids: named }),
    })
  }

export type ListTvSourceChannels = ReturnType<typeof listTvSourceChannelsFactory>
