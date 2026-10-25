import { asc, eq } from 'drizzle-orm'

import type { SubtitleTrack, SubtitleTrackRepository } from '../../core/playback/subtitles.ts'
import type { Db } from './database.ts'
import { sourceSubtitles } from './schema/libraries.ts'

type Row = typeof sourceSubtitles.$inferSelect

const toSubtitleTrack = (row: Row): SubtitleTrack => ({
  id: row.id,
  sourceId: row.sourceId,
  origin: row.kind,
  ...(row.path === null ? {} : { path: row.path }),
  ...(row.streamIndex === null ? {} : { streamIndex: row.streamIndex }),
  ...(row.language === null ? {} : { language: row.language }),
  forced: row.forced,
  sdh: row.sdh,
  isDefault: row.isDefault,
  format: row.format,
  ...(row.title === null ? {} : { title: row.title }),
})

const byOriginThenStream = (a: SubtitleTrack, b: SubtitleTrack): number =>
  a.origin === b.origin
    ? (a.streamIndex ?? 0) - (b.streamIndex ?? 0)
    : a.origin === 'external'
      ? -1
      : 1

export const createSqliteSubtitleTrackRepository = ({
  db,
}: {
  db: Db
}): SubtitleTrackRepository => ({
  listForSource: (sourceId) =>
    db
      .select()
      .from(sourceSubtitles)
      .where(eq(sourceSubtitles.sourceId, sourceId))
      .orderBy(asc(sourceSubtitles.path), asc(sourceSubtitles.streamIndex))
      .all()
      .map(toSubtitleTrack)
      .sort(byOriginThenStream),
  findById: (id) => {
    const row = db.select().from(sourceSubtitles).where(eq(sourceSubtitles.id, id)).get()
    return row && toSubtitleTrack(row)
  },
})
