import {
  type CatalogQueryState,
  catalogStateKey,
  defaultCatalogState,
  parseCatalogState,
} from '@projo/shared/api/catalog-state'

import { readStoredJson, writeStoredJson } from '../../shared/storage/local-store.ts'
import type { CatalogKind } from './queries.ts'

/** The rules live in `@projo/shared/api/catalog-state`, shared with the mobile app. */
export * from '@projo/shared/api/catalog-state'

/** Sort and filters of Movies / Shows, per profile and per device (§13.4): `localStorage`. */
export const loadCatalogState = (profileId: string, kind: CatalogKind): CatalogQueryState =>
  readStoredJson(catalogStateKey(profileId, kind), parseCatalogState) ?? defaultCatalogState

export const saveCatalogState = (
  profileId: string,
  kind: CatalogKind,
  state: CatalogQueryState,
): void => writeStoredJson(catalogStateKey(profileId, kind), state)
