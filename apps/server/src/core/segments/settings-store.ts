import type { SegmentSettings, SegmentSettingsReader } from '../settings/settings.ts'

export type SegmentSettingsStore = SegmentSettingsReader & {
  write: (
    input: {
      providers?: SegmentSettings['providers']
      theintrodbApiKey?: string | undefined
      fingerprint?: Partial<SegmentSettings['fingerprint']>
      contribution?: SegmentSettings['contribution']
    },
    at: Date,
  ) => void
  saveSkipdbAnonymousKey: (key: string, at: Date) => void
}
