import { type AppError, ok, type Result } from '@projo/shared'

import type { EditableImageKind, ImageAlternative } from '../../../core/metadata/editing.ts'
import type { MetadataItemRepository, MetadataSettings } from '../../../core/metadata/ports.ts'
import type { TmdbApi, TmdbError, TmdbImagesTarget } from '../../../core/metadata/tmdb.ts'
import { itemNotMatched } from './item-errors.ts'

const MAX_ALTERNATIVES = 60

type TargetDeps = {
  items: Pick<MetadataItemRepository, 'imageContext'>
  settings: Pick<MetadataSettings, 'language'>
}

/** Where TMDB keeps the item's images of a kind (a season poster, else the series'). */
export const tmdbImageTargetFactory =
  ({ items, settings }: TargetDeps) =>
  (
    itemId: string,
    kind: EditableImageKind,
  ): { target: TmdbImagesTarget; language: string } | undefined => {
    const context = items.imageContext(itemId)
    if (context?.tmdbId === undefined) return undefined
    const language = context.libraryLanguage ?? settings.language()
    switch (context.kind) {
      case 'movie':
        return { target: { kind: 'movie', tmdbId: context.tmdbId }, language }
      case 'series':
        return { target: { kind: 'series', tmdbId: context.tmdbId }, language }
      case 'season':
      case 'episode': {
        if (context.seriesTmdbId === undefined) return undefined
        if (context.kind === 'season' && kind === 'poster' && context.seasonNumber !== undefined) {
          return {
            target: {
              kind: 'season',
              seriesTmdbId: context.seriesTmdbId,
              seasonNumber: context.seasonNumber,
            },
            language,
          }
        }
        return { target: { kind: 'series', tmdbId: context.seriesTmdbId }, language }
      }
    }
  }

/** The TMDB images an item can show instead of its own: best voted first, then the widest. */
export const tmdbImageAlternativesFactory = ({
  items,
  settings,
  tmdb,
}: TargetDeps & { tmdb: Pick<TmdbApi, 'images'> }) => {
  const targetOf = tmdbImageTargetFactory({ items, settings })
  return async (
    itemId: string,
    kind: EditableImageKind,
  ): Promise<Result<ImageAlternative[], TmdbError | AppError<'metadata/not_matched'>>> => {
    const target = targetOf(itemId, kind)
    if (target === undefined) return itemNotMatched(itemId)
    const found = await tmdb.images(target)
    if (!found.ok) return found
    const list = kind === 'poster' ? found.value.posters : found.value.backdrops
    return ok(
      [...list]
        .sort((a, b) => b.voteAverage - a.voteAverage || b.width - a.width)
        .slice(0, MAX_ALTERNATIVES)
        .map((image) => ({
          tmdbPath: image.path,
          width: image.width,
          height: image.height,
          voteAverage: image.voteAverage,
          ...(image.language === undefined ? {} : { language: image.language }),
        })),
    )
  }
}
