import type { SegmentSettings, SegmentSettingsReader } from '../settings/settings.ts'

/** §15 "Intros and credits": the `segments.*` keys of the `settings` table, read with their defaults. */
export type SegmentSettingsStore = SegmentSettingsReader & {
  /** Writes the given values; `theintrodbApiKey: undefined` (present) removes the key. */
  write: (
    input: {
      providers?: SegmentSettings['providers']
      theintrodbApiKey?: string | undefined
      fingerprint?: Partial<SegmentSettings['fingerprint']>
      contribution?: SegmentSettings['contribution']
    },
    at: Date,
  ) => void
  /** §12.5: the SkipDB anonymous key, created by the first submission. */
  saveSkipdbAnonymousKey: (key: string, at: Date) => void
}
