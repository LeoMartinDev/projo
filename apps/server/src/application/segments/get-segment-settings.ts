import type { SegmentSettingsStore } from '../../core/segments/settings-store.ts'
import { segmentSettingsView, type SegmentSettingsView } from './shared/segment-settings-view.ts'

export const getSegmentSettingsFactory =
  ({ store }: { store: Pick<SegmentSettingsStore, 'read'> }) =>
  (): SegmentSettingsView =>
    segmentSettingsView(store)

export type GetSegmentSettings = ReturnType<typeof getSegmentSettingsFactory>
