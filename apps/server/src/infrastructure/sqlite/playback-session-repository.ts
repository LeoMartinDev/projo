import { and, eq, inArray, isNull, lte, type SQL } from 'drizzle-orm'

import { playbackQualitySchema } from '@projo/shared/api/playback'

import type {
  PlaybackScope,
  PlaybackSession,
  PlaybackSessionRepository,
} from '../../core/playback/session.ts'
import type { Db } from './database.ts'
import { fromIso, toIso } from './rows.ts'
import { sessions } from './schema/accounts.ts'
import { sources } from './schema/libraries.ts'
import { playbackSessions } from './schema/playback.ts'

type Row = { session: typeof playbackSessions.$inferSelect; accountId: string }

const toPlaybackSession = ({ session: row, accountId }: Row): PlaybackSession => {
  const quality = playbackQualitySchema.safeParse(row.quality)
  return {
    id: row.id,
    profileId: row.profileId,
    authSessionId: row.sessionId,
    accountId,
    sourceId: row.sourceId,
    itemId: row.itemId,
    mode: row.mode,
    ...(quality.success ? { quality: quality.data } : {}),
    ...(row.audioStream === null ? {} : { audioStream: row.audioStream }),
    ...(row.subtitleStream === null ? {} : { subtitleStream: row.subtitleStream }),
    ...(row.subtitleTrackId === null ? {} : { subtitleTrackId: row.subtitleTrackId }),
    burnIn: row.burnIn,
    ...(row.audioDelivery === null ? {} : { audioDelivery: row.audioDelivery }),
    startedAt: fromIso(row.startedAt),
    lastHeartbeatAt: fromIso(row.lastHeartbeatAt),
    positionMs: row.positionMs,
    ...(row.endedAt === null ? {} : { endedAt: fromIso(row.endedAt) }),
  }
}

export const createSqlitePlaybackSessionRepository = ({
  db,
}: {
  db: Db
}): PlaybackSessionRepository => {
  const select = () =>
    db
      .select({ session: playbackSessions, accountId: sessions.accountId })
      .from(playbackSessions)
      .innerJoin(sessions, eq(sessions.id, playbackSessions.sessionId))

  const within = (scope: PlaybackScope): SQL => {
    if ('itemIds' in scope) return inArray(playbackSessions.itemId, [...scope.itemIds])
    if ('profileIds' in scope) return inArray(playbackSessions.profileId, [...scope.profileIds])
    if ('accountId' in scope) return eq(sessions.accountId, scope.accountId)
    if ('sourceIds' in scope) return inArray(playbackSessions.sourceId, [...scope.sourceIds])
    const doomedSources = db
      .select({ id: sources.id })
      .from(sources)
      .where(
        'libraryId' in scope
          ? eq(sources.libraryId, scope.libraryId)
          : inArray(sources.rootId, [...scope.rootIds]),
      )
    return inArray(playbackSessions.sourceId, doomedSources)
  }

  return {
    insert: (session) => {
      db.insert(playbackSessions)
        .values({
          id: session.id,
          profileId: session.profileId,
          sessionId: session.authSessionId,
          sourceId: session.sourceId,
          itemId: session.itemId,
          mode: session.mode,
          quality: session.quality ?? null,
          audioStream: session.audioStream ?? null,
          subtitleStream: session.subtitleStream ?? null,
          subtitleTrackId: session.subtitleTrackId ?? null,
          burnIn: session.burnIn,
          audioDelivery: session.audioDelivery ?? null,
          startedAt: toIso(session.startedAt),
          lastHeartbeatAt: toIso(session.lastHeartbeatAt),
          positionMs: Math.round(session.positionMs),
          endedAt: null,
        })
        .run()
    },
    findById: (id) => {
      const row = select().where(eq(playbackSessions.id, id)).get()
      return row && toPlaybackSession(row)
    },
    heartbeat: ({ id, at, positionMs }) => {
      db.update(playbackSessions)
        .set({ lastHeartbeatAt: toIso(at), positionMs: Math.round(positionMs) })
        .where(eq(playbackSessions.id, id))
        .run()
    },
    end: ({ id, at }) => {
      db.update(playbackSessions)
        .set({ endedAt: toIso(at) })
        .where(and(eq(playbackSessions.id, id), isNull(playbackSessions.endedAt)))
        .run()
    },
    listStale: ({ notAfter }) =>
      select()
        .where(
          and(
            isNull(playbackSessions.endedAt),
            lte(playbackSessions.lastHeartbeatAt, toIso(notAfter)),
          ),
        )
        .all()
        .map(toPlaybackSession),
    listActive: () => select().where(isNull(playbackSessions.endedAt)).all().map(toPlaybackSession),
    listActiveWithin: (scope) =>
      select()
        .where(and(isNull(playbackSessions.endedAt), within(scope)))
        .all()
        .map(toPlaybackSession),
  }
}
