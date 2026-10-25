import { alias } from 'drizzle-orm/sqlite-core'
import { and, desc, eq, isNull } from 'drizzle-orm'

import { playbackQualitySchema } from '@projo/shared/api/playback'

import { ownTitle } from '../../core/catalog/generic-titles.ts'
import type {
  ActivePlaybackSessionView,
  AdminPlaybackSessionQueries,
} from '../../core/playback/admin-sessions.ts'
import { sourceVersionOf } from '../../core/media/version.ts'
import { readMediaInfo } from '../playback/probe-reader.ts'
import type { Db } from './database.ts'
import { fromIso, stripNulls } from './rows.ts'
import { readParsedEdition } from './source-columns.ts'
import { accounts, profiles, sessions } from './schema/accounts.ts'
import { items } from './schema/items.ts'
import { sourceItems, sources } from './schema/libraries.ts'
import { playbackSessions } from './schema/playback.ts'

const seasons = alias(items, 'season')
const series = alias(items, 'series')

/**
 * Item duration of the version played (§8.4), as the heartbeats measure it: the source's, or its
 * ready parts added up; undefined when one has no duration.
 */
const versionDurationMs = (
  db: Db,
  row: { probe: unknown; stackGroupId: string | null; itemId: string },
): number | undefined => {
  if (row.stackGroupId === null) return readMediaInfo(row.probe)?.durationMs
  const durations = db
    .select({ probe: sources.probe })
    .from(sourceItems)
    .innerJoin(sources, eq(sources.id, sourceItems.sourceId))
    .where(
      and(
        eq(sourceItems.itemId, row.itemId),
        eq(sources.stackGroupId, row.stackGroupId),
        eq(sources.state, 'ready'),
      ),
    )
    .all()
    .map((part) => readMediaInfo(part.probe)?.durationMs)
  if (durations.length === 0 || durations.some((duration) => duration === undefined)) {
    return undefined
  }
  return durations.reduce<number>((total, duration) => total + (duration ?? 0), 0)
}

/** §10.6 "the admin sees active sessions": who watches what, from which device. */
export const createSqliteAdminPlaybackSessions = ({
  db,
}: {
  db: Db
}): AdminPlaybackSessionQueries => ({
  listActive: () =>
    db
      .select({
        session: playbackSessions,
        accountName: accounts.username,
        accountId: accounts.id,
        profileName: profiles.name,
        profileColor: profiles.avatarColor,
        device: sessions.deviceName,
        itemKind: items.kind,
        itemTitle: items.title,
        seasonNumber: items.seasonNumber,
        episodeNumber: items.episodeNumber,
        seriesTitle: series.title,
        parsed: sources.parsed,
        probe: sources.probe,
        stackGroupId: sources.stackGroupId,
      })
      .from(playbackSessions)
      .innerJoin(sessions, eq(sessions.id, playbackSessions.sessionId))
      .innerJoin(accounts, eq(accounts.id, sessions.accountId))
      .innerJoin(profiles, eq(profiles.id, playbackSessions.profileId))
      .innerJoin(items, eq(items.id, playbackSessions.itemId))
      .innerJoin(sources, eq(sources.id, playbackSessions.sourceId))
      .leftJoin(seasons, eq(seasons.id, items.parentId))
      .leftJoin(series, eq(series.id, seasons.parentId))
      .where(isNull(playbackSessions.endedAt))
      .orderBy(desc(playbackSessions.startedAt))
      .all()
      .map((row): ActivePlaybackSessionView => {
        const quality = playbackQualitySchema.safeParse(row.session.quality)
        const extra = stripNulls({
          seriesTitle: row.itemKind === 'episode' ? row.seriesTitle : null,
          seasonNumber: row.seasonNumber,
          episodeNumber: row.episodeNumber,
        })
        const title = ownTitle({ kind: row.itemKind, title: row.itemTitle, ...extra })
        const durationMs = versionDurationMs(db, {
          probe: row.probe,
          stackGroupId: row.stackGroupId,
          itemId: row.session.itemId,
        })
        return {
          id: row.session.id,
          account: { id: row.accountId, name: row.accountName },
          profile: { id: row.session.profileId, name: row.profileName, color: row.profileColor },
          item: {
            id: row.session.itemId,
            kind: row.itemKind === 'episode' ? 'episode' : 'movie',
            ...(title === undefined ? {} : { title }),
            ...extra,
          },
          mode: row.session.mode,
          ...(quality.success ? { quality: quality.data } : {}),
          burnIn: row.session.burnIn,
          version: sourceVersionOf(
            readMediaInfo(row.probe)?.video[0],
            readParsedEdition(row.parsed),
          ),
          positionMs: row.session.positionMs,
          ...(durationMs === undefined ? {} : { durationMs }),
          ...(row.device === '' ? {} : { device: row.device }),
          startedAt: fromIso(row.session.startedAt),
          lastHeartbeatAt: fromIso(row.session.lastHeartbeatAt),
        }
      }),
})
