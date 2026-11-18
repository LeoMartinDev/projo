import { and, asc, count, eq, inArray, sql } from 'drizzle-orm'
import { z } from 'zod'

import { searchNameOf } from '../../core/tv/channel.ts'
import type { TvGuideChannel, TvGuideChannelRepository } from '../../core/tv/guide.ts'
import type { Db } from './database.ts'
import { chunks, parseJsonColumn } from './rows.ts'
import { tvGuideChannels } from './schema/tv.ts'

const namesSchema = z.array(z.string())

const escapeLike = (value: string): string => value.replace(/[\\%_]/gu, (char) => `\\${char}`)

const toGuideChannel = (row: typeof tvGuideChannels.$inferSelect): TvGuideChannel => ({
  id: row.key,
  names: parseJsonColumn(namesSchema, row.names, 'tv_guide_channels.names'),
})

/** A source's guide channels of its last read (§29.3), what the admin picks from. */
export const createSqliteTvGuideChannelRepository = ({
  db,
}: {
  db: Db
}): TvGuideChannelRepository => ({
  replaceForSource: ({ sourceId, channels }) => {
    db.transaction((tx) => {
      tx.delete(tvGuideChannels).where(eq(tvGuideChannels.sourceId, sourceId)).run()
      const rows = channels.map((channel, position) => ({
        sourceId,
        key: channel.id,
        names: channel.names,
        searchText: searchNameOf([channel.id, ...channel.names].join('\n')),
        position,
      }))
      for (const part of chunks(rows, 200)) tx.insert(tvGuideChannels).values(part).run()
    })
  },

  list: ({ sourceId, search, offset, limit }) => {
    const where = and(
      eq(tvGuideChannels.sourceId, sourceId),
      search === undefined || search === ''
        ? undefined
        : sql`${tvGuideChannels.searchText} LIKE ${`%${escapeLike(search)}%`} ESCAPE '\\'`,
    )
    const total = db.select({ total: count() }).from(tvGuideChannels).where(where).get()?.total ?? 0
    const items = db
      .select()
      .from(tvGuideChannels)
      .where(where)
      .orderBy(asc(tvGuideChannels.position))
      .limit(limit)
      .offset(offset)
      .all()
      .map(toGuideChannel)
    return { items, total }
  },

  findMany: ({ sourceId, ids }) => {
    const found = new Map<string, TvGuideChannel>()
    for (const part of chunks([...new Set(ids)])) {
      for (const row of db
        .select()
        .from(tvGuideChannels)
        .where(and(eq(tvGuideChannels.sourceId, sourceId), inArray(tvGuideChannels.key, part)))
        .all())
        found.set(row.key.toLowerCase(), toGuideChannel(row))
    }
    return found
  },
})
