import { and, eq, inArray, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/sqlite-core'

import type { ItemProgress, ProgressRepository } from '../../core/progress/progress.ts'
import type { PlayedItem, ProgressQueries } from '../../core/progress/rows.ts'
import { visible, visibleAs } from './catalog-sql.ts'
import type { Db } from './database.ts'
import { chunks, fromIso, toIso } from './rows.ts'
import { items } from './schema/items.ts'
import { playbackProgress } from './schema/playback.ts'

type ProgressRow = typeof playbackProgress.$inferSelect

/** `listPlayed`: an episode's season and series. */
const playedSeason = alias(items, 'played_season')
const playedSeries = alias(items, 'played_series')

const toItemProgress = (row: ProgressRow): ItemProgress => ({
  profileId: row.profileId,
  itemId: row.itemId,
  positionMs: row.positionMs,
  durationMs: row.durationMs,
  watched: row.watched,
  ...(row.watchedAt === null ? {} : { watchedAt: fromIso(row.watchedAt) }),
  playCount: row.playCount,
  lastPlayedAt: fromIso(row.lastPlayedAt),
  hiddenFromContinue: row.hiddenFromContinue,
})

const toRow = (progress: ItemProgress): ProgressRow => ({
  profileId: progress.profileId,
  itemId: progress.itemId,
  positionMs: Math.round(progress.positionMs),
  durationMs: Math.round(progress.durationMs),
  watched: progress.watched,
  watchedAt: progress.watchedAt === undefined ? null : toIso(progress.watchedAt),
  playCount: progress.playCount,
  lastPlayedAt: toIso(progress.lastPlayedAt),
  hiddenFromContinue: progress.hiddenFromContinue,
})

export const createSqliteProgressRepository = ({
  db,
}: {
  db: Db
}): ProgressRepository & ProgressQueries => {
  const save = (progress: ItemProgress): void => {
    const row = toRow(progress)
    const { profileId: _p, itemId: _i, ...update } = row
    db.insert(playbackProgress)
      .values(row)
      .onConflictDoUpdate({
        target: [playbackProgress.profileId, playbackProgress.itemId],
        set: update,
      })
      .run()
  }
  return {
    find: ({ profileId, itemId }) => {
      const row = db
        .select()
        .from(playbackProgress)
        .where(and(eq(playbackProgress.profileId, profileId), eq(playbackProgress.itemId, itemId)))
        .get()
      return row && toItemProgress(row)
    },
    findMany: ({ profileId, itemIds }) => {
      const result = new Map<string, ItemProgress>()
      for (const chunk of chunks(itemIds)) {
        const rows = db
          .select()
          .from(playbackProgress)
          .where(
            and(eq(playbackProgress.profileId, profileId), inArray(playbackProgress.itemId, chunk)),
          )
          .all()
        for (const row of rows) result.set(row.itemId, toItemProgress(row))
      }
      return result
    },
    save,
    saveMany: (progress) => {
      db.transaction(() => {
        for (const entry of progress) save(entry)
      })
    },
    showAncestorsAgain: ({ profileId, itemId }) => {
      db.run(sql`UPDATE playback_progress SET hidden_from_continue = 0
        WHERE profile_id = ${profileId} AND hidden_from_continue = 1 AND item_id IN (
          SELECT parent.id FROM items child CROSS JOIN items parent ON parent.id = child.parent_id
            WHERE child.id = ${itemId}
          UNION ALL
          SELECT grand.id FROM items child CROSS JOIN items parent ON parent.id = child.parent_id
            CROSS JOIN items grand ON grand.id = parent.parent_id WHERE child.id = ${itemId})`)
    },
    listPlayed: ({ profileId, scope }) =>
      db
        .select({
          progress: playbackProgress,
          kind: items.kind,
          // Episodes: season → series (local and TMDB items always have a season).
          seriesId: playedSeason.parentId,
          seasonNumber: sql<
            number | null
          >`coalesce(${items.seasonNumber}, ${playedSeason.seasonNumber})`,
          episodeNumber: items.episodeNumber,
          // 1: visible. 0: an episode whose files are gone, of a series still visible (§13.1:
          // the show stays started). NULL: neither, left out.
          presence: sql<number | null>`CASE WHEN ${visible(scope)} THEN 1
              WHEN +${items.kind} = 'episode' AND ${visibleAs('played_series', scope)} THEN 0 END`,
        })
        .from(playbackProgress)
        .innerJoin(items, eq(items.id, playbackProgress.itemId))
        .leftJoin(playedSeason, eq(playedSeason.id, items.parentId))
        .leftJoin(playedSeries, eq(playedSeries.id, playedSeason.parentId))
        .where(
          and(
            eq(playbackProgress.profileId, profileId),
            sql`+${items.kind} IN ('movie', 'episode')`,
          ),
        )
        .all()
        .flatMap(
          ({ progress, kind, seriesId, seasonNumber, episodeNumber, presence }): PlayedItem[] =>
            presence !== null && (kind === 'movie' || kind === 'episode')
              ? [
                  {
                    itemId: progress.itemId,
                    kind,
                    ...(kind === 'episode' && seriesId !== null ? { seriesId } : {}),
                    ...(kind === 'episode' && seasonNumber !== null ? { seasonNumber } : {}),
                    ...(kind === 'episode' && episodeNumber !== null ? { episodeNumber } : {}),
                    ...(presence === 0 ? { absent: true as const } : {}),
                    progress: toItemProgress(progress),
                  },
                ]
              : [],
        ),
  }
}
