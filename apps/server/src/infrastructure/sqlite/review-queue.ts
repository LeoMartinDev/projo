import { and, desc, eq } from 'drizzle-orm'
import { alias } from 'drizzle-orm/sqlite-core'

import type { ReviewCandidate, ReviewQueue } from '../../core/source/review-groups.ts'
import type { Db } from './database.ts'
import { stripNulls } from './rows.ts'
import { items } from './schema/items.ts'
import { sourceItems, sources } from './schema/libraries.ts'

const episodes = alias(items, 'episode')
const seasons = alias(items, 'season')
const shows = alias(items, 'show')

type Episode = NonNullable<ReviewCandidate['episode']>

// SQLite ascending order: an absent number first
const before = (a: Episode, b: Episode): boolean => {
  const order = (x: number | undefined, y: number | undefined) =>
    x === y ? 0 : x === undefined ? -1 : y === undefined ? 1 : x - y
  return (order(a.seasonNumber, b.seasonNumber) || order(a.episodeNumber, b.episodeNumber)) < 0
}

/**
 * The files of "To review" (§7.8) in one query: each source with the episodes it is linked to
 * under a show (one row per link, none for a movie or an unlinked file), in `page`'s order.
 */
export const createSqliteReviewQueue = ({ db }: { db: Db }): ReviewQueue => ({
  candidates: ({ libraryId }) => {
    const rows = db
      .select({
        id: sources.id,
        rootId: sources.rootId,
        relativePath: sources.relativePath,
        reviewReason: sources.reviewReason,
        showId: shows.id,
        showTitle: shows.title,
        seasonNumber: episodes.seasonNumber,
        episodeNumber: episodes.episodeNumber,
      })
      .from(sources)
      .leftJoin(sourceItems, eq(sourceItems.sourceId, sources.id))
      .leftJoin(episodes, and(eq(episodes.id, sourceItems.itemId), eq(episodes.kind, 'episode')))
      .leftJoin(seasons, eq(seasons.id, episodes.parentId))
      .leftJoin(shows, eq(shows.id, seasons.parentId))
      .where(
        and(
          eq(sources.state, 'ready'),
          eq(sources.matchState, 'needs_review'),
          libraryId === undefined ? undefined : eq(sources.libraryId, libraryId),
        ),
      )
      .orderBy(desc(sources.id))
      .all()
    const byId = new Map<string, ReviewCandidate>()
    for (const row of rows) {
      const { id, rootId, relativePath, reviewReason, showId, showTitle, ...numbers } =
        stripNulls(row)
      const episode: Episode | undefined =
        showId === undefined
          ? undefined
          : { showId, ...(showTitle === undefined ? {} : { showTitle }), ...numbers }
      const known = byId.get(id)
      if (known === undefined) {
        byId.set(id, {
          id,
          rootId,
          relativePath,
          ...(reviewReason === undefined ? {} : { reviewReason }),
          ...(episode === undefined ? {} : { episode }),
        })
      } else if (
        episode !== undefined &&
        (known.episode === undefined || before(episode, known.episode))
      ) {
        byId.set(id, { ...known, episode })
      }
    }
    return [...byId.values()]
  },
})
