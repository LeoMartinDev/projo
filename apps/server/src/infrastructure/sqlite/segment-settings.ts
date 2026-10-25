import { eq } from 'drizzle-orm'
import { z } from 'zod'

import { segmentProviderIds } from '../../core/segments/segment.ts'
import type { SegmentSettingsStore } from '../../core/segments/settings-store.ts'
import {
  defaultSegmentSettings,
  type SegmentSettings,
  type SettingKey,
  settingKeys,
} from '../../core/settings/settings.ts'
import type { Db } from './database.ts'
import { toIso } from './rows.ts'
import { settings } from './schema/ops.ts'

const key = z.string().trim().min(1)

const schemas = {
  providers: z
    .array(z.enum(segmentProviderIds))
    .transform((ids) => [...new Set(ids)] as SegmentSettings['providers']),
  enabled: z.boolean(),
  introMinutes: z.number().int().min(1),
  creditsMinutes: z.number().int().min(1),
  minSeconds: z.number().int().min(1),
  maxSeconds: z.number().int().min(1),
  similarity: z.number().min(0).max(1),
  contribution: z.enum(['off', 'manual_only']),
}

const fingerprintKeys = {
  enabled: settingKeys.fingerprintEnabled,
  introMinutes: settingKeys.fingerprintIntroMinutes,
  creditsMinutes: settingKeys.fingerprintCreditsMinutes,
  minSeconds: settingKeys.fingerprintMinSeconds,
  maxSeconds: settingKeys.fingerprintMaxSeconds,
  similarity: settingKeys.fingerprintSimilarity,
} as const satisfies Record<keyof SegmentSettings['fingerprint'], SettingKey>

/** §12 `segments.*` keys of the `settings` table; an unset or invalid value reads as its default. */
export const createSqliteSegmentSettings = ({ db }: { db: Db }): SegmentSettingsStore => {
  const read = (settingKey: SettingKey): unknown =>
    db.select().from(settings).where(eq(settings.key, settingKey)).get()?.value
  const parse = <T>(schema: z.ZodType<T>, settingKey: SettingKey, fallback: T): T => {
    const parsed = schema.safeParse(read(settingKey))
    return parsed.success ? parsed.data : fallback
  }
  const optionalKey = (settingKey: SettingKey): string | undefined => {
    const parsed = key.safeParse(read(settingKey))
    return parsed.success ? parsed.data : undefined
  }
  const put = (settingKey: SettingKey, value: unknown, at: Date): void => {
    if (value === undefined) {
      db.delete(settings).where(eq(settings.key, settingKey)).run()
      return
    }
    db.insert(settings)
      .values({ key: settingKey, value, updatedAt: toIso(at) })
      .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: toIso(at) } })
      .run()
  }

  const fingerprint = (): SegmentSettings['fingerprint'] => {
    const defaults = defaultSegmentSettings.fingerprint
    return {
      enabled: parse(schemas.enabled, fingerprintKeys.enabled, defaults.enabled),
      introMinutes: parse(
        schemas.introMinutes,
        fingerprintKeys.introMinutes,
        defaults.introMinutes,
      ),
      creditsMinutes: parse(
        schemas.creditsMinutes,
        fingerprintKeys.creditsMinutes,
        defaults.creditsMinutes,
      ),
      minSeconds: parse(schemas.minSeconds, fingerprintKeys.minSeconds, defaults.minSeconds),
      maxSeconds: parse(schemas.maxSeconds, fingerprintKeys.maxSeconds, defaults.maxSeconds),
      similarity: parse(schemas.similarity, fingerprintKeys.similarity, defaults.similarity),
    }
  }

  return {
    read: () => {
      const theintrodbApiKey = optionalKey(settingKeys.theintrodbApiKey)
      const skipdbAnonymousKey = optionalKey(settingKeys.skipdbAnonymousKey)
      return {
        providers: parse(
          schemas.providers,
          settingKeys.segmentProviders,
          defaultSegmentSettings.providers,
        ),
        ...(theintrodbApiKey === undefined ? {} : { theintrodbApiKey }),
        ...(skipdbAnonymousKey === undefined ? {} : { skipdbAnonymousKey }),
        fingerprint: fingerprint(),
        contribution: parse(
          schemas.contribution,
          settingKeys.segmentContribution,
          defaultSegmentSettings.contribution,
        ),
      }
    },
    write: (input, at) => {
      db.transaction(() => {
        if (input.providers !== undefined) put(settingKeys.segmentProviders, input.providers, at)
        if ('theintrodbApiKey' in input)
          put(settingKeys.theintrodbApiKey, input.theintrodbApiKey, at)
        if (input.contribution !== undefined) {
          put(settingKeys.segmentContribution, input.contribution, at)
        }
        for (const [name, value] of Object.entries(input.fingerprint ?? {})) {
          if (value === undefined) continue
          put(fingerprintKeys[name as keyof typeof fingerprintKeys], value, at)
        }
      })
    },
    saveSkipdbAnonymousKey: (anonymousKey, at) =>
      put(settingKeys.skipdbAnonymousKey, anonymousKey, at),
  }
}
