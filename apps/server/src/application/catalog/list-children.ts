import { appError, type AppError, err, ok, type Result } from '@projo/shared'

import {
  type CatalogReadModel,
  isPlayableKind,
  type VisibilityScope,
} from '../../core/catalog/catalog.ts'
import type { CatalogEntries, CatalogEntry } from './catalog-entries.ts'

type Deps = {
  catalogReadModel: Pick<CatalogReadModel, 'findVisible' | 'listVisibleChildren'>
  catalogEntries: CatalogEntries
}

export type ListChildrenError = AppError<'item/not_found' | 'item/invalid_kind'>

export const listChildrenFactory =
  ({ catalogReadModel, catalogEntries }: Deps) =>
  async ({
    id,
    profileId,
    scope,
  }: {
    id: string
    profileId: string
    scope: VisibilityScope
  }): Promise<Result<CatalogEntry[], ListChildrenError>> => {
    const item = catalogReadModel.findVisible({ id, scope })
    if (item === undefined) {
      return err(appError('item/not_found', 'item not found', { context: { itemId: id } }))
    }
    if (isPlayableKind(item.kind)) {
      return err(
        appError('item/invalid_kind', 'only series and seasons have children', {
          context: { itemId: id, kind: item.kind },
        }),
      )
    }
    const children = catalogReadModel.listVisibleChildren({ parentId: id, scope })
    return ok(catalogEntries({ profileId, items: children, scope }))
  }

export type ListChildren = ReturnType<typeof listChildrenFactory>
