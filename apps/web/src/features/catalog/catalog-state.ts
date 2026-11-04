import {
  type CatalogQueryState,
  catalogStateKey,
  defaultCatalogState,
  parseCatalogState,
} from '@projo/shared/api/catalog-state'

import { readStoredJson, writeStoredJson } from '../../shared/storage/local-store.ts'
import type { CatalogKind } from './queries.ts'

export * from '@projo/shared/api/catalog-state'

export const loadCatalogState = (profileId: string, kind: CatalogKind): CatalogQueryState =>
  readStoredJson(catalogStateKey(profileId, kind), parseCatalogState) ?? defaultCatalogState

export const saveCatalogState = (
  profileId: string,
  kind: CatalogKind,
  state: CatalogQueryState,
): void => writeStoredJson(catalogStateKey(profileId, kind), state)
