import type { MetadataRefreshRepository } from '../../../core/metadata/editing.ts'
import type { MetadataSettings } from '../../../core/metadata/ports.ts'

type Settings = Pick<MetadataSettings, 'language'>

/** Top-level items written in another language than the one their deciding library asks. */
export const staleLanguageFactory =
  ({
    refreshRepository,
    settings,
  }: {
    refreshRepository: Pick<MetadataRefreshRepository, 'staleLanguage'>
    settings: Settings
  }) =>
  (libraryId?: string): string[] =>
    refreshRepository.staleLanguage({
      serverLanguage: settings.language(),
      ...(libraryId === undefined ? {} : { libraryId }),
    })

/** The trees that became stale, or whose deciding country changed since `countryBefore`. */
export const staleTreesFactory =
  ({
    refreshRepository,
    settings,
  }: {
    refreshRepository: Pick<MetadataRefreshRepository, 'treeStates'>
    settings: Settings
  }) =>
  (topIds: readonly string[], countryBefore?: ReadonlyMap<string, string>): string[] =>
    refreshRepository
      .treeStates({ topIds, serverLanguage: settings.language() })
      .filter(
        (state) =>
          state.stale ||
          (countryBefore !== undefined && countryBefore.get(state.topId) !== state.ratingCountry),
      )
      .map((state) => state.topId)
