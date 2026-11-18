import { eq, inArray, lte, sql } from 'drizzle-orm'

import {
  nowAndNextOf,
  type TvGuideRepository,
  type TvNowNext,
  type TvProgramme,
} from '../../core/tv/guide.ts'
import type { IdGenerator } from '../../core/ids.ts'
import type { Db } from './database.ts'
import { chunks, fromIso, toIso, toNullable } from './rows.ts'
import { tvChannels, tvProgrammes } from './schema/tv.ts'

type ProgrammeRow = {
  channel_id: string
  start_at: string
  end_at: string
  title: string
  subtitle: string | null
  description: string | null
  category: string | null
}

const toProgramme = (row: ProgrammeRow): TvProgramme => ({
  channelId: row.channel_id,
  startAt: fromIso(row.start_at),
  endAt: fromIso(row.end_at),
  title: row.title,
  ...(row.subtitle === null ? {} : { subtitle: row.subtitle }),
  ...(row.description === null ? {} : { description: row.description }),
  ...(row.category === null ? {} : { category: row.category }),
})

/** The guide's programmes (§29.3): replaced per source, read as now and next. */
export const createSqliteTvGuideRepository = ({
  db,
  ids,
}: {
  db: Db
  ids: IdGenerator
}): TvGuideRepository => ({
  replaceForSource: ({ sourceId, programmes, now }) => {
    db.transaction((tx) => {
      const channelIds = tx
        .select({ id: tvChannels.id })
        .from(tvChannels)
        .where(eq(tvChannels.sourceId, sourceId))
        .all()
        .map(({ id }) => id)
      for (const part of chunks(channelIds)) {
        tx.delete(tvProgrammes).where(inArray(tvProgrammes.channelId, part)).run()
      }
      tx.delete(tvProgrammes)
        .where(lte(tvProgrammes.endAt, toIso(now)))
        .run()
      const known = new Set(channelIds)
      const rows = programmes
        .filter((programme) => known.has(programme.channelId))
        .map((programme) => ({
          id: ids.next(),
          channelId: programme.channelId,
          startAt: toIso(programme.startAt),
          endAt: toIso(programme.endAt),
          title: programme.title,
          subtitle: toNullable(programme.subtitle),
          description: toNullable(programme.description),
          category: toNullable(programme.category),
        }))
      for (const part of chunks(rows, 200)) tx.insert(tvProgrammes).values(part).run()
    })
  },

  deleteEnded: (now) =>
    db
      .delete(tvProgrammes)
      .where(lte(tvProgrammes.endAt, toIso(now)))
      .returning({ id: tvProgrammes.id })
      .all().length,

  nowAndNext: (at) => {
    const time = toIso(at)
    // Each enabled, present channel's first two programmes ending after `at`.
    const rows = db.all<ProgrammeRow>(sql`
      SELECT channel_id, start_at, end_at, title, subtitle, description, category FROM (
        SELECT p.channel_id, p.start_at, p.end_at, p.title, p.subtitle, p.description,
          p.category,
          row_number() OVER (PARTITION BY p.channel_id ORDER BY p.start_at) AS rank
        FROM ${tvProgrammes} p
        JOIN ${tvChannels} c ON c.id = p.channel_id
        WHERE p.end_at > ${time} AND c.enabled = 1 AND c.missing_since IS NULL
      )
      WHERE rank <= 2
      ORDER BY channel_id, start_at`)
    const byChannel = new Map<string, TvProgramme[]>()
    for (const row of rows) {
      const programme = toProgramme(row)
      const list = byChannel.get(programme.channelId)
      if (list === undefined) byChannel.set(programme.channelId, [programme])
      else list.push(programme)
    }
    const guide = new Map<string, TvNowNext>()
    for (const [channelId, programmes] of byChannel) {
      const entry = nowAndNextOf(programmes, at)
      if (entry.now !== undefined || entry.next !== undefined) guide.set(channelId, entry)
    }
    return guide
  },
})
