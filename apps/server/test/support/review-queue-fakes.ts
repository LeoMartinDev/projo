import type { LinkedItemInfo } from '../../src/core/metadata/linking.ts'
import type { ReviewCandidate, ReviewQueue } from '../../src/core/source/review-groups.ts'
import { awaitsReview } from '../../src/core/source/review-groups.ts'
import type { Source } from '../../src/core/source/source.ts'

type ReviewSource = Pick<
  Source,
  'id' | 'libraryId' | 'rootId' | 'relativePath' | 'state' | 'matchState' | 'reviewReason'
>

type Item = LinkedItemInfo & { title?: string }

// SQLite ascending order: an absent number first
const ascending = (a: number | undefined, b: number | undefined): number =>
  a === b ? 0 : a === undefined ? -1 : b === undefined ? 1 : a - b

/**
 * In-memory `ReviewQueue` over sources, items and their links, like the SQLite adapter: the files
 * to review newest id first, each with its lowest linked episode under a show.
 */
export const inMemoryReviewQueue = ({
  sources,
  item,
  linksOf,
}: {
  sources: () => Iterable<ReviewSource>
  item: (id: string) => Item | undefined
  linksOf: (sourceId: string) => readonly string[]
}): ReviewQueue => {
  const episodeOf = (sourceId: string): ReviewCandidate['episode'] => {
    const [first] = linksOf(sourceId)
      .flatMap((id) => {
        const episode = item(id)
        if (episode?.kind !== 'episode' || episode.parentId === undefined) return []
        const show = item(episode.parentId)?.parentId
        return show === undefined ? [] : [{ episode, show: item(show) }]
      })
      .sort(
        (a, b) =>
          ascending(a.episode.seasonNumber, b.episode.seasonNumber) ||
          ascending(a.episode.episodeNumber, b.episode.episodeNumber),
      )
    if (first?.show === undefined) return undefined
    const { episode, show } = first
    return {
      showId: show.id,
      ...(show.title === undefined ? {} : { showTitle: show.title }),
      ...(episode.seasonNumber === undefined ? {} : { seasonNumber: episode.seasonNumber }),
      ...(episode.episodeNumber === undefined ? {} : { episodeNumber: episode.episodeNumber }),
    }
  }
  return {
    candidates: ({ libraryId }) =>
      [...sources()]
        .filter(
          (source) =>
            awaitsReview(source) && (libraryId === undefined || source.libraryId === libraryId),
        )
        .sort((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0))
        .map((source) => {
          const episode = episodeOf(source.id)
          return {
            id: source.id,
            rootId: source.rootId,
            relativePath: source.relativePath,
            ...(source.reviewReason === undefined ? {} : { reviewReason: source.reviewReason }),
            ...(episode === undefined ? {} : { episode }),
          }
        }),
  }
}
