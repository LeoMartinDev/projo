import { createHash } from 'node:crypto'

import { and, eq, gt, inArray, isNull, lt, lte, sql } from 'drizzle-orm'
import { z } from 'zod'

import { tvProgrammeKindSchema } from '@projo/shared/api/tv'

import {
  nowAndNextOf,
  TV_GUIDE_PAST_MS,
  type TvEpisode,
  type TvGuideRepository,
  type TvGuideText,
  type TvNowNext,
  type TvProgramme,
} from '../../core/tv/guide.ts'
import type { IdGenerator } from '../../core/ids.ts'
import type { Db } from './database.ts'
import { chunks, fromIso, toIso, toNullable } from './rows.ts'
import { tvChannels, tvProgrammeImages, tvProgrammes } from './schema/tv.ts'

/** The key of a programme image (§29.3): the SHA-256 of its URL, in hex. */
export const tvProgrammeImageKeyOf = (url: string): string =>
  createHash('sha256').update(url).digest('hex')

type ProgrammeRow = {
  id: string
  channel_id: string
  start_at: string
  end_at: string
  title: string
  subtitle: string | null
  description: string | null
  categories: string | null
  kind: string
  episode_season: number | null
  episode_number: number | null
  episode_label: string | null
  image_url: string | null
  image_key: string | null
  image_path: string | null
}

const categoriesSchema = z.array(z.object({ text: z.string(), lang: z.string().optional() }))

/** A stored column is a cache of the guide: one that no longer parses reads as empty. */
const toCategories = (value: string | null): TvGuideText[] => {
  if (value === null) return []
  const parsed = categoriesSchema.safeParse(
    (() => {
      try {
        return JSON.parse(value) as unknown
      } catch {
        return undefined
      }
    })(),
  )
  return parsed.success
    ? parsed.data.map(({ text, lang }) => ({ text, ...(lang === undefined ? {} : { lang }) }))
    : []
}

const toEpisode = (
  row: Pick<ProgrammeRow, 'episode_season' | 'episode_number' | 'episode_label'>,
): TvEpisode | undefined => {
  const episode: TvEpisode = {
    ...(row.episode_season === null ? {} : { season: row.episode_season }),
    ...(row.episode_number === null ? {} : { episode: row.episode_number }),
    ...(row.episode_label === null ? {} : { label: row.episode_label }),
  }
  return Object.keys(episode).length === 0 ? undefined : episode
}

const toProgramme = (row: ProgrammeRow): TvProgramme => {
  const kind = tvProgrammeKindSchema.safeParse(row.kind)
  const episode = toEpisode(row)
  return {
    id: row.id,
    channelId: row.channel_id,
    startAt: fromIso(row.start_at),
    endAt: fromIso(row.end_at),
    title: row.title,
    ...(row.subtitle === null ? {} : { subtitle: row.subtitle }),
    ...(row.description === null ? {} : { description: row.description }),
    categories: toCategories(row.categories),
    kind: kind.success ? kind.data : 'other',
    ...(episode === undefined ? {} : { episode }),
    ...(row.image_url === null ? {} : { imageUrl: row.image_url }),
    ...(row.image_key === null ? {} : { imageKey: row.image_key }),
    imageStored: row.image_path !== null,
  }
}

const programmeColumns = sql`p.id, p.channel_id, p.start_at, p.end_at, p.title, p.subtitle,
  p.description, p.categories, p.kind, p.episode_season, p.episode_number, p.episode_label,
  p.image_url, p.image_key, i.path AS image_path`

/** The guide's programmes (§29.3): replaced per source, read as now and next and one by one. */
export const createSqliteTvGuideRepository = ({
  db,
  ids,
}: {
  db: Db
  ids: IdGenerator
}): TvGuideRepository => {
  const keptAfter = (now: Date) => toIso(new Date(now.getTime() - TV_GUIDE_PAST_MS))

  return {
    replaceForSource: ({ sourceId, programmes, now }) => {
      db.transaction((tx) => {
        const channelIds = tx
          .select({ id: tvChannels.id })
          .from(tvChannels)
          .where(eq(tvChannels.sourceId, sourceId))
          .all()
          .map(({ id }) => id)
        // A programme whose channel and start were stored keeps its id (§29.3).
        const known = new Map<string, string>()
        for (const part of chunks(channelIds)) {
          for (const row of tx
            .select({
              id: tvProgrammes.id,
              channelId: tvProgrammes.channelId,
              startAt: tvProgrammes.startAt,
            })
            .from(tvProgrammes)
            .where(inArray(tvProgrammes.channelId, part))
            .all())
            known.set(`${row.channelId}|${row.startAt}`, row.id)
          tx.delete(tvProgrammes).where(inArray(tvProgrammes.channelId, part)).run()
        }
        tx.delete(tvProgrammes)
          .where(lte(tvProgrammes.endAt, keptAfter(now)))
          .run()
        const own = new Set(channelIds)
        const used = new Set<string>()
        const rows = programmes
          .filter((programme) => own.has(programme.channelId))
          .map((programme) => {
            const startAt = toIso(programme.startAt)
            const previous = known.get(`${programme.channelId}|${startAt}`)
            const id = previous === undefined || used.has(previous) ? ids.next() : previous
            used.add(id)
            return {
              id,
              channelId: programme.channelId,
              startAt,
              endAt: toIso(programme.endAt),
              title: programme.title,
              subtitle: toNullable(programme.subtitle),
              description: toNullable(programme.description),
              category: toNullable(programme.categories[0]?.text),
              categories: programme.categories,
              kind: programme.kind,
              episodeSeason: toNullable(programme.episode?.season),
              episodeNumber: toNullable(programme.episode?.episode),
              episodeLabel: toNullable(programme.episode?.label),
              imageUrl: toNullable(programme.imageUrl),
              imageKey:
                programme.imageUrl === undefined ? null : tvProgrammeImageKeyOf(programme.imageUrl),
            }
          })
        for (const part of chunks(rows, 100)) tx.insert(tvProgrammes).values(part).run()
      })
    },

    deleteEnded: (now) =>
      db
        .delete(tvProgrammes)
        .where(lte(tvProgrammes.endAt, keptAfter(now)))
        .returning({ id: tvProgrammes.id })
        .all().length,

    nowAndNext: (at) => {
      const time = toIso(at)
      // Each enabled, present channel's first two programmes ending after `at`.
      const rows = db.all<ProgrammeRow>(sql`
        SELECT * FROM (
          SELECT ${programmeColumns},
            row_number() OVER (PARTITION BY p.channel_id ORDER BY p.start_at) AS rank
          FROM ${tvProgrammes} p
          JOIN ${tvChannels} c ON c.id = p.channel_id
          LEFT JOIN ${tvProgrammeImages} i ON i.key = p.image_key
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

    findProgramme: (id) => {
      const [row] = db.all<ProgrammeRow>(sql`
        SELECT ${programmeColumns}
        FROM ${tvProgrammes} p
        JOIN ${tvChannels} c ON c.id = p.channel_id
        LEFT JOIN ${tvProgrammeImages} i ON i.key = p.image_key
        WHERE p.id = ${id} AND c.missing_since IS NULL`)
      return row === undefined ? undefined : toProgramme(row)
    },

    programmeAfter: ({ channelId, at }) => {
      const [row] = db.all<ProgrammeRow>(sql`
        SELECT ${programmeColumns}
        FROM ${tvProgrammes} p
        LEFT JOIN ${tvProgrammeImages} i ON i.key = p.image_key
        WHERE p.channel_id = ${channelId} AND p.start_at >= ${toIso(at)}
        ORDER BY p.start_at
        LIMIT 1`)
      return row === undefined ? undefined : toProgramme(row)
    },

    schedule: ({ channelIds, from, to }) =>
      chunks(channelIds).flatMap((part) =>
        db
          .select({
            id: tvProgrammes.id,
            channelId: tvProgrammes.channelId,
            startAt: tvProgrammes.startAt,
            endAt: tvProgrammes.endAt,
            title: tvProgrammes.title,
            kind: tvProgrammes.kind,
            episodeSeason: tvProgrammes.episodeSeason,
            episodeNumber: tvProgrammes.episodeNumber,
            episodeLabel: tvProgrammes.episodeLabel,
          })
          .from(tvProgrammes)
          .innerJoin(tvChannels, eq(tvChannels.id, tvProgrammes.channelId))
          .where(
            and(
              inArray(tvProgrammes.channelId, part),
              gt(tvProgrammes.endAt, toIso(from)),
              lt(tvProgrammes.startAt, toIso(to)),
              eq(tvChannels.enabled, true),
              isNull(tvChannels.missingSince),
            ),
          )
          .orderBy(tvProgrammes.channelId, tvProgrammes.startAt)
          .all()
          .map((row) => {
            const kind = tvProgrammeKindSchema.safeParse(row.kind)
            const episode = toEpisode({
              episode_season: row.episodeSeason,
              episode_number: row.episodeNumber,
              episode_label: row.episodeLabel,
            })
            return {
              id: row.id,
              channelId: row.channelId,
              startAt: fromIso(row.startAt),
              endAt: fromIso(row.endAt),
              title: row.title,
              kind: kind.success ? kind.data : 'other',
              ...(episode === undefined ? {} : { episode }),
            }
          }),
      ),
  }
}
