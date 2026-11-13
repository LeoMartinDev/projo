import type { MetadataSettings } from '../../core/metadata/ports.ts'
import {
  type MetadataSettingsView,
  metadataSettingsViewOf,
} from './shared/metadata-settings-view.ts'

export const getMetadataSettingsFactory =
  ({
    settings,
  }: {
    settings: Pick<MetadataSettings, 'language' | 'tmdbApiKey' | 'tmdbApiKeyRejectedAt'>
  }) =>
  (): MetadataSettingsView =>
    metadataSettingsViewOf(settings)

export type GetMetadataSettings = ReturnType<typeof getMetadataSettingsFactory>
