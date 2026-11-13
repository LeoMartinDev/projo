import type { AppError, Result } from '@projo/shared'

import type { Clock } from '../../core/clock.ts'
import type { EventBus } from '../../core/events.ts'
import type { Logger } from '../../core/logger.ts'
import {
  type EditableField,
  type ItemOverrideRepository,
  lockableFieldOf,
} from '../../core/metadata/editing.ts'
import type { ItemMetadata } from '../../core/metadata/enrichment.ts'
import type { FetchImages } from './fetch-images.ts'
import type { LoadCurrentMetadata } from './load-current-metadata.ts'
import { itemNotFound } from './shared/item-errors.ts'
import { type ItemMetadataView, itemMetadataViewFactory } from './shared/item-metadata-view.ts'

type Deps = {
  overrides: Pick<ItemOverrideRepository, 'item' | 'get' | 'remove'>
  fetchImages: FetchImages
  loadCurrentMetadata: LoadCurrentMetadata
  eventBus: EventBus
  clock: Clock
  logger: Logger
}

export type RemoveItemOverrideError = AppError<'item/not_found'>

const restoredOf = (field: 'title' | 'year' | 'overview' | 'genres', metadata: ItemMetadata) => {
  switch (field) {
    case 'title':
      return { title: metadata.title }
    case 'year':
      return { year: metadata.year }
    case 'overview':
      return { overview: metadata.overview }
    case 'genres':
      return { genres: metadata.genres }
  }
}

/** "Back to TMDB": unlocks a field and puts TMDB's value (or images) back (§9.3). */
export const removeItemOverrideFactory = ({
  overrides,
  fetchImages,
  loadCurrentMetadata,
  eventBus,
  clock,
  logger,
}: Deps) => {
  const view = itemMetadataViewFactory({ overrides })
  return async ({
    itemId,
    field,
  }: {
    itemId: string
    field: EditableField
  }): Promise<Result<ItemMetadataView, RemoveItemOverrideError>> => {
    const item = overrides.item(itemId)
    if (item === undefined) return itemNotFound(itemId)
    const lockable = lockableFieldOf[field]
    if (field === 'poster' || field === 'backdrop') {
      overrides.remove({ itemId, field: lockable, at: clock.now() })
      if (item.tmdbId !== undefined) {
        const fetched = await fetchImages({ itemId })
        if (!fetched.ok) {
          logger.warn('TMDB image not restored', { itemId, field, code: fetched.error.code })
        }
      }
    } else {
      const current = await loadCurrentMetadata(itemId)
      if (!current.ok) {
        logger.info('TMDB value not restored', { itemId, field, code: current.error.code })
      }
      const metadata = current.ok ? current.value : undefined
      overrides.remove({
        itemId,
        field: lockable,
        ...(metadata === undefined ? {} : { restored: restoredOf(field, metadata) }),
        at: clock.now(),
      })
    }
    logger.info('item lock removed', { itemId, field })
    eventBus.publish('catalog.changed', {})
    return view(itemId)
  }
}

export type RemoveItemOverride = ReturnType<typeof removeItemOverrideFactory>
