import type { AppError, Result } from '@projo/shared'
import type { GenreId } from '@projo/shared/api/genres'

import type { Clock } from '../../core/clock.ts'
import type { EventBus } from '../../core/events.ts'
import type { Logger } from '../../core/logger.ts'
import type { ItemOverrideRepository } from '../../core/metadata/editing.ts'
import { itemNotFound } from './shared/item-errors.ts'
import { type ItemMetadataView, itemMetadataViewFactory } from './shared/item-metadata-view.ts'

type Deps = {
  overrides: Pick<ItemOverrideRepository, 'item' | 'get' | 'set'>
  eventBus: EventBus
  clock: Clock
  logger: Logger
}

export type TextOverrides = { title?: string; year?: number; overview?: string; genres?: GenreId[] }

export type SetItemOverridesError = AppError<'item/not_found'>

export const setItemOverridesFactory = ({ overrides, eventBus, clock, logger }: Deps) => {
  const view = itemMetadataViewFactory({ overrides })
  return ({
    itemId,
    overrides: values,
  }: {
    itemId: string
    overrides: TextOverrides
  }): Result<ItemMetadataView, SetItemOverridesError> => {
    if (overrides.item(itemId) === undefined) return itemNotFound(itemId)
    overrides.set({ itemId, overrides: values, at: clock.now() })
    logger.info('item metadata edited', { itemId, fields: Object.keys(values) })
    eventBus.publish('catalog.changed', {})
    return view(itemId)
  }
}

export type SetItemOverrides = ReturnType<typeof setItemOverridesFactory>
