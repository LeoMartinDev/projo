import type { LibraryHint } from '@projo/shared/api/libraries'
import type { EditionId } from '@projo/shared/api/versions'

export type { LibraryHint }

export type Classification = 'movie' | 'episode' | 'unknown'

export type IdTags = {
  readonly tmdb?: number
  readonly imdb?: string
  readonly tvdb?: number
}

export type PartInfo = {
  readonly index: number
  readonly label: string
}

export type ParsedName = {
  readonly title?: string
  readonly year?: number
  readonly series?: string
  readonly season?: number
  readonly episode?: number
  readonly episodeEnd?: number
  readonly episodeTitle?: string
  readonly absoluteEpisode?: number
  readonly absoluteEpisodeEnd?: number
  readonly airDate?: string
  readonly edition?: EditionId
  readonly editionName?: string
  readonly part?: PartInfo
  readonly ids?: IdTags
}

export type NamingReviewReason =
  'classification_ambiguous' | 'hint_conflict' | 'date_based' | 'no_episode_number'

export type MediaPathAnalysis = {
  readonly classification: Classification
  readonly parsed: ParsedName
  readonly displayTitle: string
  readonly reviewReason?: NamingReviewReason
}

export type MediaPathInput = {
  readonly relativePath: string
  readonly hint: LibraryHint
}
