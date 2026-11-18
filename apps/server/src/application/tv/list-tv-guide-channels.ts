import { type AppError, appError, err, ok, type Result } from '@projo/shared'

import { searchNameOf } from '../../core/tv/channel.ts'
import type { TvGuideChannel, TvGuideChannelRepository } from '../../core/tv/guide.ts'
import type { TvSourceRepository } from '../../core/tv/source.ts'

type Deps = {
  tvSources: Pick<TvSourceRepository, 'findById'>
  guideChannels: Pick<TvGuideChannelRepository, 'list'>
}

export type ListTvGuideChannelsError = AppError<'tv/source_not_found'>

export type TvGuideChannelsPage = { items: TvGuideChannel[]; nextCursor?: string; total: number }

const offsetOf = (cursor: string | undefined): number => {
  const offset = cursor === undefined ? 0 : Number(cursor)
  return Number.isSafeInteger(offset) && offset > 0 ? offset : 0
}

/**
 * The guide channels of a source's last guide read (§29.3), in the guide's order, searched in
 * ids and display names and paged: what the admin's picker offers (§29.6).
 */
export const listTvGuideChannelsFactory =
  ({ tvSources, guideChannels }: Deps) =>
  ({
    sourceId,
    q,
    cursor,
    limit,
  }: {
    sourceId: string
    q?: string
    cursor?: string
    limit: number
  }): Result<TvGuideChannelsPage, ListTvGuideChannelsError> => {
    if (tvSources.findById(sourceId) === undefined)
      return err(
        appError('tv/source_not_found', 'tv source not found', { context: { id: sourceId } }),
      )
    const offset = offsetOf(cursor)
    const search = q === undefined ? '' : searchNameOf(q.trim())
    const { items, total } = guideChannels.list({
      sourceId,
      ...(search === '' ? {} : { search }),
      offset,
      limit,
    })
    const next = offset + items.length
    return ok({ items, total, ...(next < total ? { nextCursor: String(next) } : {}) })
  }

export type ListTvGuideChannels = ReturnType<typeof listTvGuideChannelsFactory>
