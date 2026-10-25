import { inArray } from 'drizzle-orm'
import { z } from 'zod'

import type {
  FingerprintSettings,
  FingerprintSettingsReader,
} from '../../core/segments/fingerprint.ts'
import { defaultSegmentSettings, settingKeys } from '../../core/settings/settings.ts'
import type { Db } from './database.ts'
import { settings } from './schema/ops.ts'

const positive = z.number().positive()
const schemas = {
  enabled: z.boolean(),
  introMinutes: positive,
  creditsMinutes: positive,
  minSeconds: positive,
  maxSeconds: positive,
  similarity: z.number().min(0.5).max(1),
} satisfies { [K in keyof FingerprintSettings]: z.ZodType<FingerprintSettings[K]> }

const keys = {
  enabled: settingKeys.fingerprintEnabled,
  introMinutes: settingKeys.fingerprintIntroMinutes,
  creditsMinutes: settingKeys.fingerprintCreditsMinutes,
  minSeconds: settingKeys.fingerprintMinSeconds,
  maxSeconds: settingKeys.fingerprintMaxSeconds,
  similarity: settingKeys.fingerprintSimilarity,
} as const satisfies Record<keyof FingerprintSettings, string>

/**
 * The `segments.fingerprint_*` keys of the `settings` table, for the `fingerprint_season` job
 * (§12.3, defaults of §24 when unset or invalid; `minSeconds > maxSeconds` reads as both
 * defaults). Kept apart from the segments settings reader: can be merged into it.
 */
export const createSqliteFingerprintSettings = ({ db }: { db: Db }): FingerprintSettingsReader => ({
  read: () => {
    const rows = db
      .select()
      .from(settings)
      .where(inArray(settings.key, Object.values(keys)))
      .all()
    const stored = new Map(rows.map((row) => [row.key, row.value]))
    const value = <K extends keyof FingerprintSettings>(key: K): FingerprintSettings[K] => {
      const parsed = schemas[key].safeParse(stored.get(keys[key]))
      return parsed.success
        ? (parsed.data as FingerprintSettings[K])
        : defaultSegmentSettings.fingerprint[key]
    }
    const read: FingerprintSettings = {
      enabled: value('enabled'),
      introMinutes: value('introMinutes'),
      creditsMinutes: value('creditsMinutes'),
      minSeconds: value('minSeconds'),
      maxSeconds: value('maxSeconds'),
      similarity: value('similarity'),
    }
    if (read.minSeconds <= read.maxSeconds) return read
    const { minSeconds, maxSeconds } = defaultSegmentSettings.fingerprint
    return { ...read, minSeconds, maxSeconds }
  },
})
