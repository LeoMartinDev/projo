import {
  and,
  asc,
  count,
  eq,
  inArray,
  isNotNull,
  isNull,
  lt,
  ne,
  or,
  type SQL,
  sql,
} from 'drizzle-orm'
import { z } from 'zod'

import {
  searchNameOf,
  type TvChannel,
  type TvChannelRepository,
  type TvGroup,
  type TvGroupSummary,
} from '../../core/tv/channel.ts'
import type { Db } from './database.ts'
import { chunks, fromIso, parseJsonColumn, stripNulls, toIso, toNullable } from './rows.ts'
import { tvChannels, tvGroups } from './schema/tv.ts'

const upstreamSchema = z.object({
  url: z.string(),
  userAgent: z.string().optional(),
  referrer: z.string().optional(),
})

const toUpstream = (value: unknown): TvChannel['upstream'] => {
  const { url, userAgent, referrer } = parseJsonColumn(
    upstreamSchema,
    value,
    'tv_channels.upstream',
  )
  return {
    url,
    ...(userAgent === undefined ? {} : { userAgent }),
    ...(referrer === undefined ? {} : { referrer }),
  }
}

const toChannel = (row: typeof tvChannels.$inferSelect): TvChannel => {
  const {
    number,
    guideKey,
    logoUrl,
    logoPath,
    logoFetchedUrl,
    logoFetchedAt,
    logoFailedAt,
    missingSince,
    ...rest
  } = stripNulls(row)
  return {
    id: rest.id,
    sourceId: rest.sourceId,
    key: rest.key,
    name: rest.name,
    ...(number === undefined ? {} : { number }),
    groupId: rest.groupId,
    position: rest.position,
    upstream: toUpstream(rest.upstream),
    ...(guideKey === undefined ? {} : { guideKey }),
    ...(logoUrl === undefined ? {} : { logoUrl }),
    ...(logoPath === undefined ? {} : { logoPath }),
    ...(logoFetchedUrl === undefined ? {} : { logoFetchedUrl }),
    ...(logoFetchedAt === undefined ? {} : { logoFetchedAt: fromIso(logoFetchedAt) }),
    ...(logoFailedAt === undefined ? {} : { logoFailedAt: fromIso(logoFailedAt) }),
    enabled: rest.enabled,
    ...(missingSince === undefined ? {} : { missingSince: fromIso(missingSince) }),
    createdAt: fromIso(rest.createdAt),
  }
}

const toGroup = (row: typeof tvGroups.$inferSelect): TvGroup => ({
  id: row.id,
  sourceId: row.sourceId,
  name: row.name,
  enabled: row.enabled,
  position: row.position,
})

const present = isNull(tvChannels.missingSince)

const escapeLike = (value: string): string => value.replace(/[\\%_]/gu, (char) => `\\${char}`)

export const createSqliteTvChannelRepository = ({ db }: { db: Db }): TvChannelRepository => {
  const summaries = (where: SQL): TvGroupSummary[] => {
    const groups = db
      .select()
      .from(tvGroups)
      .where(where)
      .orderBy(asc(tvGroups.position))
      .all()
      .map(toGroup)
    if (groups.length === 0) return []
    const counts = new Map(
      db
        .select({
          groupId: tvChannels.groupId,
          channelCount: count(),
          enabledChannelCount: sql<number>`coalesce(sum(${tvChannels.enabled}), 0)`,
        })
        .from(tvChannels)
        .where(
          and(
            inArray(
              tvChannels.groupId,
              groups.map((group) => group.id),
            ),
            present,
          ),
        )
        .groupBy(tvChannels.groupId)
        .all()
        .map((row) => [row.groupId, row]),
    )
    return groups.map((group) => {
      const own = counts.get(group.id)
      return {
        ...group,
        channelCount: own?.channelCount ?? 0,
        enabledChannelCount: Number(own?.enabledChannelCount ?? 0),
      }
    })
  }

  return {
    stateOf: (sourceId) => ({
      groups: db.select().from(tvGroups).where(eq(tvGroups.sourceId, sourceId)).all().map(toGroup),
      channels: db
        .select()
        .from(tvChannels)
        .where(eq(tvChannels.sourceId, sourceId))
        .all()
        .map(toChannel),
    }),

    applyRefresh: (plan) => {
      db.transaction((tx) => {
        for (const group of plan.groups.insert) {
          tx.insert(tvGroups)
            .values({
              id: group.id,
              sourceId: group.sourceId,
              name: group.name,
              enabled: group.enabled,
              position: group.position,
            })
            .run()
        }
        for (const { id, position } of plan.groups.update) {
          tx.update(tvGroups).set({ position }).where(eq(tvGroups.id, id)).run()
        }
        for (const channel of plan.channels.insert) {
          tx.insert(tvChannels)
            .values({
              id: channel.id,
              sourceId: channel.sourceId,
              key: channel.key,
              name: channel.name,
              searchName: searchNameOf(channel.name),
              number: toNullable(channel.number),
              groupId: channel.groupId,
              position: channel.position,
              upstream: channel.upstream,
              guideKey: toNullable(channel.guideKey),
              logoUrl: toNullable(channel.logoUrl),
              enabled: channel.enabled,
              createdAt: toIso(channel.createdAt),
            })
            .run()
        }
        for (const update of plan.channels.update) {
          tx.update(tvChannels)
            .set({
              name: update.name,
              searchName: searchNameOf(update.name),
              number: toNullable(update.number),
              groupId: update.groupId,
              position: update.position,
              upstream: update.upstream,
              guideKey: toNullable(update.guideKey),
              logoUrl: toNullable(update.logoUrl),
              missingSince: null,
            })
            .where(eq(tvChannels.id, update.id))
            .run()
        }
        const missingAt = toIso(plan.channels.markMissing.at)
        for (const ids of chunks(plan.channels.markMissing.ids)) {
          tx.update(tvChannels)
            .set({ missingSince: missingAt })
            .where(and(inArray(tvChannels.id, ids), present))
            .run()
        }
        for (const ids of chunks(plan.channels.delete)) {
          tx.delete(tvChannels).where(inArray(tvChannels.id, ids)).run()
        }
        for (const ids of chunks(plan.groups.delete)) {
          tx.delete(tvGroups).where(inArray(tvGroups.id, ids)).run()
        }
      })
    },

    countsBySource: () =>
      new Map(
        db
          .select({
            sourceId: tvChannels.sourceId,
            channelCount: count(),
            enabledChannelCount: sql<number>`coalesce(sum(${tvChannels.enabled}), 0)`,
          })
          .from(tvChannels)
          .where(present)
          .groupBy(tvChannels.sourceId)
          .all()
          .map((row) => [
            row.sourceId,
            {
              channelCount: row.channelCount,
              enabledChannelCount: Number(row.enabledChannelCount),
            },
          ]),
      ),

    groupsOf: (sourceId) => summaries(eq(tvGroups.sourceId, sourceId)),

    findGroup: (id) => summaries(eq(tvGroups.id, id))[0],

    setGroupEnabled: ({ id, enabled }) => {
      db.transaction((tx) => {
        tx.update(tvGroups).set({ enabled }).where(eq(tvGroups.id, id)).run()
        tx.update(tvChannels).set({ enabled }).where(eq(tvChannels.groupId, id)).run()
      })
    },

    findChannel: (id) => {
      const row = db.select().from(tvChannels).where(eq(tvChannels.id, id)).get()
      return row === undefined ? undefined : toChannel(row)
    },

    setChannelEnabled: ({ id, enabled }) => {
      db.update(tvChannels).set({ enabled }).where(eq(tvChannels.id, id)).run()
    },

    listChannels: ({ sourceId, search, groupId, offset, limit }) => {
      const where = and(
        eq(tvChannels.sourceId, sourceId),
        present,
        groupId === undefined ? undefined : eq(tvChannels.groupId, groupId),
        search === undefined || search === ''
          ? undefined
          : sql`${tvChannels.searchName} LIKE ${`%${escapeLike(search)}%`} ESCAPE '\\'`,
      )
      const total = db.select({ total: count() }).from(tvChannels).where(where).get()?.total ?? 0
      const items = db
        .select()
        .from(tvChannels)
        .where(where)
        .orderBy(asc(tvChannels.position))
        .limit(limit)
        .offset(offset)
        .all()
        .map(toChannel)
      return { items, total }
    },

    logoWork: ({ sourceId, retryFailedBefore }) => {
      const enabledPresent = and(
        eq(tvChannels.sourceId, sourceId),
        eq(tvChannels.enabled, true),
        present,
      )
      const fetch = db
        .select()
        .from(tvChannels)
        .where(
          and(
            enabledPresent,
            isNotNull(tvChannels.logoUrl),
            or(
              isNull(tvChannels.logoFetchedUrl),
              ne(tvChannels.logoFetchedUrl, tvChannels.logoUrl),
              lt(tvChannels.logoFailedAt, toIso(retryFailedBefore)),
            ),
          ),
        )
        .orderBy(asc(tvChannels.position))
        .all()
        .map(toChannel)
      const drop = db
        .select()
        .from(tvChannels)
        .where(
          and(
            eq(tvChannels.sourceId, sourceId),
            isNull(tvChannels.logoUrl),
            isNotNull(tvChannels.logoPath),
          ),
        )
        .all()
        .map(toChannel)
      return { fetch, drop }
    },

    recordLogo: ({ id, url, at, path }) =>
      db
        .update(tvChannels)
        .set(
          path === undefined
            ? { logoFetchedUrl: url, logoFailedAt: toIso(at) }
            : { logoFetchedUrl: url, logoFetchedAt: toIso(at), logoFailedAt: null, logoPath: path },
        )
        .where(eq(tvChannels.id, id))
        .returning({ id: tvChannels.id })
        .all().length > 0,

    dropLogo: (id) => {
      db.update(tvChannels)
        .set({ logoPath: null, logoFetchedUrl: null, logoFetchedAt: null, logoFailedAt: null })
        .where(eq(tvChannels.id, id))
        .run()
    },

    logoPathsOf: (sourceId) =>
      db
        .select({ logoPath: tvChannels.logoPath })
        .from(tvChannels)
        .where(and(eq(tvChannels.sourceId, sourceId), isNotNull(tvChannels.logoPath)))
        .all()
        .flatMap(({ logoPath }) => (logoPath === null ? [] : [logoPath])),
  }
}
