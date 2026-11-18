import type { Clock } from '../../core/clock.ts'
import {
  matchTvChannels,
  parseTvSearch,
  type TvSearchChannel,
  type TvSearchProgramme,
  type TvSearchReadModel,
  tvSearchRules,
} from '../../core/tv/search.ts'
import type { TvProfileAccess } from '../../core/tv/viewer.ts'

export type TvSearchResults = {
  channels: TvSearchChannel[]
  programmes: { programme: TvSearchProgramme; channel: TvSearchChannel }[]
}

const nothing: TvSearchResults = { channels: [], programmes: [] }

/**
 * The search's TV sections (§29.6): the matching channels the profile sees, and the matching
 * programmes of those channels that have not ended, each with its channel; nothing without Live
 * TV access. Below 2 characters, only the channel of the number typed.
 */
export const searchTvFactory =
  ({
    tvSearch,
    tvAccess,
    clock,
  }: {
    tvSearch: TvSearchReadModel
    tvAccess: TvProfileAccess
    clock: Clock
  }) =>
  ({ query, profileId }: { query: string; profileId: string }): TvSearchResults => {
    const parsed = parseTvSearch(query)
    if (parsed === undefined || !tvAccess.hasLiveTv(profileId)) return nothing
    const channels = tvSearch.viewableChannels()
    const byId = new Map(channels.map((channel) => [channel.id, channel]))
    const programmes =
      parsed.words.length === 0
        ? []
        : tvSearch.matchingProgrammes({
            words: parsed.words,
            at: clock.now(),
            limit: tvSearchRules.maxProgrammes,
          })
    return {
      channels: matchTvChannels(channels, parsed),
      programmes: programmes.flatMap((programme) => {
        const channel = byId.get(programme.channelId)
        return channel === undefined ? [] : [{ programme, channel }]
      }),
    }
  }

export type SearchTv = ReturnType<typeof searchTvFactory>
