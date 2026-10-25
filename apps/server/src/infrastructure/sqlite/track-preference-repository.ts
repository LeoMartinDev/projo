import { and, eq } from 'drizzle-orm'

import type {
  TrackPreferenceRepository,
  TrackPreferences,
} from '../../core/playback/track-preferences.ts'
import type { Db } from './database.ts'
import { fromIso, toIso } from './rows.ts'
import { trackPreferences } from './schema/playback.ts'

type Row = typeof trackPreferences.$inferSelect

const toTrackPreferences = (row: Row): TrackPreferences => ({
  profileId: row.profileId,
  itemId: row.itemId,
  ...(row.audioLanguage === null ? {} : { audioLanguage: row.audioLanguage }),
  ...(row.subtitleLanguage === null ? {} : { subtitleLanguage: row.subtitleLanguage }),
  subtitlesEnabled: row.subtitlesEnabled,
  updatedAt: fromIso(row.updatedAt),
})

export const createSqliteTrackPreferenceRepository = ({
  db,
}: {
  db: Db
}): TrackPreferenceRepository => {
  const byKey = ({ profileId, itemId }: { profileId: string; itemId: string }) =>
    and(eq(trackPreferences.profileId, profileId), eq(trackPreferences.itemId, itemId))
  return {
    find: (key) => {
      const row = db.select().from(trackPreferences).where(byKey(key)).get()
      return row && toTrackPreferences(row)
    },
    save: (preferences) => {
      const values = {
        audioLanguage: preferences.audioLanguage ?? null,
        subtitleLanguage: preferences.subtitleLanguage ?? null,
        subtitlesEnabled: preferences.subtitlesEnabled,
        updatedAt: toIso(preferences.updatedAt),
      }
      db.insert(trackPreferences)
        .values({ profileId: preferences.profileId, itemId: preferences.itemId, ...values })
        .onConflictDoUpdate({
          target: [trackPreferences.profileId, trackPreferences.itemId],
          set: values,
        })
        .run()
    },
    delete: (key) => {
      const existed = db.select().from(trackPreferences).where(byKey(key)).get() !== undefined
      db.delete(trackPreferences).where(byKey(key)).run()
      return existed
    },
  }
}
