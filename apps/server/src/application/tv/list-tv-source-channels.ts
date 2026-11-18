import { type AppError, appError, err, ok, type Result } from '@projo/shared'

import { searchNameOf, type TvChannel, type TvChannelRepository } from '../../core/tv/channel.ts'
import type { TvSourceRepository } from '../../core/tv/source.ts'

type Deps = {
  tvSources: Pick<TvSourceRepository, 'findById'>
  tvChannels: Pick<TvChannelRepository, 'listChannels'>
}

export type ListTvSourceChannelsError = AppError<'tv/source_not_found'>

export type TvChannelsPage = { items: TvChannel[]; nextCursor?: string; total: number }

const offsetOf = (cursor: string | undefined): number => {
  const offset = cursor === undefined ? 0 : Number(cursor)
  return Number.isSafeInteger(offset) && offset > 0 ? offset : 0
}

/** A source's present channels for its dialog, in playlist order, searched and paged (§29.7). */
export const listTvSourceChannelsFactory =
  ({ tvSources, tvChannels }: Deps) =>
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
    return ok({ items, total, ...(next < total ? { nextCursor: String(next) } : {}) })
  }

export type ListTvSourceChannels = ReturnType<typeof listTvSourceChannelsFactory>
