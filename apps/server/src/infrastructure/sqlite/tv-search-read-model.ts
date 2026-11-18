import { and, asc, eq, isNull, sql } from 'drizzle-orm'

import { tvProgrammeKindSchema } from '@projo/shared/api/tv'

import type { TvSearchReadModel } from '../../core/tv/search.ts'
import type { Db } from './database.ts'
import { fromIso, toIso } from './rows.ts'
import { tvChannels, tvGroups, tvProgrammes, tvSources } from './schema/tv.ts'
import { toEpisode } from './tv-guide-repository.ts'

type ProgrammeRow = {
  id: string
  channel_id: string
  start_at: string
  end_at: string
  title: string
  subtitle: string | null
  kind: string
  episode_season: number | null
  episode_number: number | null
  episode_label: string | null
}

/**
 * The search's TV reads (§29.6). Channels are few enough to be matched in memory; programmes are
 * matched on `search_text` (` word word…`), one `LIKE '% <word>%'` per query word: a word's start.
 * The words hold only letters and digits (`tvSearchWordsOf`), never a `LIKE` wildcard. No index
 * serves a word inside a text: the programmes not ended are scanned (§29.6, measured by
 * `test/integration/tv-search-perf.test.ts`).
 */
export const createSqliteTvSearchReadModel = ({ db }: { db: Db }): TvSearchReadModel => ({
  viewableChannels: () =>
    db
      .select({
        id: tvChannels.id,
        name: tvChannels.name,
        number: tvChannels.number,
        logoPath: tvChannels.logoPath,
      })
      .from(tvChannels)
      .innerJoin(tvGroups, eq(tvGroups.id, tvChannels.groupId))
      .innerJoin(tvSources, eq(tvSources.id, tvChannels.sourceId))
      .where(and(eq(tvChannels.enabled, true), isNull(tvChannels.missingSince)))
      .orderBy(
        asc(tvSources.name),
        asc(tvSources.id),
        asc(tvGroups.position),
        asc(tvChannels.position),
      )
      .all()
      .map(({ id, name, number, logoPath }) => ({
        id,
        name,
        ...(number === null ? {} : { number }),
        ...(logoPath === null ? {} : { logoPath }),
      })),

  matchingProgrammes: ({ words, at, limit }) => {
    if (words.length === 0) return []
    const time = toIso(at)
    const matches = sql.join(
      words.map((word) => sql`p.search_text LIKE ${`% ${word}%`}`),
      sql` AND `,
    )
    return db
      .all<ProgrammeRow>(
        sql`
        SELECT p.id, p.channel_id, p.start_at, p.end_at, p.title, p.subtitle, p.kind,
          p.episode_season, p.episode_number, p.episode_label
        FROM ${tvProgrammes} p
        JOIN ${tvChannels} c ON c.id = p.channel_id
        JOIN ${tvGroups} g ON g.id = c.group_id
        JOIN ${tvSources} s ON s.id = c.source_id
        WHERE p.end_at > ${time} AND ${matches}
          AND c.enabled = 1 AND c.missing_since IS NULL
        ORDER BY p.start_at <= ${time} DESC, p.start_at, s.name, s.id, g.position, c.position, p.id
        LIMIT ${limit}`,
      )
      .map((row) => {
        const kind = tvProgrammeKindSchema.safeParse(row.kind)
        const episode = toEpisode(row)
        return {
          id: row.id,
          channelId: row.channel_id,
          title: row.title,
          ...(row.subtitle === null ? {} : { subtitle: row.subtitle }),
          ...(episode === undefined ? {} : { episode }),
          kind: kind.success ? kind.data : 'other',
          startAt: fromIso(row.start_at),
          endAt: fromIso(row.end_at),
        }
      })
  },
})
