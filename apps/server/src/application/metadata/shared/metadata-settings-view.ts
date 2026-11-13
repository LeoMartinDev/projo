import type { MetadataSettings } from '../../../core/metadata/ports.ts'

export type TmdbKeyState = 'missing' | 'valid' | 'rejected'

export type MetadataSettingsView = {
  language: string
  tmdbApiKey: { configured: boolean; state: TmdbKeyState; last4?: string }
}

export const metadataSettingsViewOf = (
  settings: Pick<MetadataSettings, 'language' | 'tmdbApiKey' | 'tmdbApiKeyRejectedAt'>,
): MetadataSettingsView => {
  const key = settings.tmdbApiKey()
  return {
    language: settings.language(),
    tmdbApiKey:
      key === undefined
        ? { configured: false, state: 'missing' }
        : {
            configured: true,
            state: settings.tmdbApiKeyRejectedAt() === undefined ? 'valid' : 'rejected',
            last4: key.slice(-4),
          },
  }
}
