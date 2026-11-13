import type { MetadataRefreshRepository } from '../../../core/metadata/editing.ts'
import type { MetadataSettings } from '../../../core/metadata/ports.ts'

const RATING_FALLBACK_COUNTRY = 'US'

export type RefreshContext = { language: string; ratingCountry: string }

/** Language and rating country of an item: those of its deciding library (§9.1). */
export const refreshContextFactory =
  ({
    refreshRepository,
    settings,
  }: {
    refreshRepository: Pick<MetadataRefreshRepository, 'libraryOf'>
    settings: Pick<MetadataSettings, 'language'>
  }) =>
  (itemId: string): RefreshContext => {
    const library = refreshRepository.libraryOf(itemId)
    return {
      language: library?.language ?? settings.language(),
      ratingCountry: library?.ratingCountry ?? RATING_FALLBACK_COUNTRY,
    }
  }
