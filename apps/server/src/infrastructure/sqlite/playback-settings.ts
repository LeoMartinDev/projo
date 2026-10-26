import { eq } from 'drizzle-orm'
import { z } from 'zod'

import {
  defaultPlaybackSettings,
  type PlaybackSettings,
  type PlaybackSettingsReader,
  type PlaybackSettingsWriter,
  type SettingKey,
  settingKeys,
} from '../../core/settings/settings.ts'
import type { Db } from './database.ts'
import { toIso } from './rows.ts'
import { settings } from './schema/ops.ts'

const schemas = {
  audioDownmix: z.enum(['stereo', 'keep']),
  maxConcurrentTranscodes: z.number().int().min(0),
  transcodeCacheMaxGb: z.number().positive(),
  burnInEnabled: z.boolean(),
  trickplayEnabled: z.boolean(),
  hwAccel: z.enum(['off', 'vaapi']),
} satisfies { [K in keyof PlaybackSettings]: z.ZodType<PlaybackSettings[K]> }

/** §10 playback keys of the `settings` table; an unset or invalid value reads as its default. */
export const createSqlitePlaybackSettings = ({ db }: { db: Db }): PlaybackSettingsReader => {
  const read = (key: SettingKey): unknown =>
    db.select().from(settings).where(eq(settings.key, key)).get()?.value
  const value = <K extends keyof PlaybackSettings>(key: K): PlaybackSettings[K] => {
    const parsed = schemas[key].safeParse(read(settingKeys[key]))
    return parsed.success ? (parsed.data as PlaybackSettings[K]) : defaultPlaybackSettings[key]
  }
  return {
    read: () => ({
      audioDownmix: value('audioDownmix'),
      maxConcurrentTranscodes: value('maxConcurrentTranscodes'),
      transcodeCacheMaxGb: value('transcodeCacheMaxGb'),
      burnInEnabled: value('burnInEnabled'),
      trickplayEnabled: value('trickplayEnabled'),
      hwAccel: value('hwAccel'),
    }),
  }
}

const editableKeys = [
  'audioDownmix',
  'maxConcurrentTranscodes',
  'transcodeCacheMaxGb',
  'burnInEnabled',
  'trickplayEnabled',
  'hwAccel',
] as const satisfies readonly (keyof PlaybackSettings)[]

/** §15 "Playback": writes the given keys, in one transaction; the reader sees them at once. */
export const createSqlitePlaybackSettingsWriter = ({ db }: { db: Db }): PlaybackSettingsWriter => ({
  write: ({ values, at }) => {
    db.transaction((tx) => {
      for (const key of editableKeys) {
        const value = values[key]
        if (value === undefined) continue
        tx.insert(settings)
          .values({ key: settingKeys[key], value, updatedAt: toIso(at) })
          .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: toIso(at) } })
          .run()
      }
    })
  },
})
