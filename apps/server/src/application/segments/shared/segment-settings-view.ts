import type { SegmentSettingsStore } from '../../../core/segments/settings-store.ts'
import type { SegmentSettings } from '../../../core/settings/settings.ts'

export type SegmentSettingsView = Omit<
  SegmentSettings,
  'theintrodbApiKey' | 'skipdbAnonymousKey'
> & {
  theintrodbApiKey: { configured: boolean; last4?: string }
}

/** The settings as the admin sees them: the TheIntroDB key never leaves, only its last 4. */
export const segmentSettingsView = (
  store: Pick<SegmentSettingsStore, 'read'>,
): SegmentSettingsView => {
  const { theintrodbApiKey, skipdbAnonymousKey: _anonymous, ...rest } = store.read()
  return {
    ...rest,
    theintrodbApiKey:
      theintrodbApiKey === undefined
        ? { configured: false }
        : { configured: true, last4: theintrodbApiKey.slice(-4) },
  }
}
