import { useSyncExternalStore } from 'react'

import {
  arrivalState,
  type CatalogQueryState,
  type CatalogSearch,
  catalogStateKey,
  defaultCatalogState,
  parseCatalogState,
} from '@projo/shared/api/catalog-state'

import { readStoredJson, writeStoredJson } from '../../shared/storage/local-store.ts'
import type { CatalogKind } from './queries.ts'

export * from '@projo/shared/api/catalog-state'

const known = new Map<string, CatalogQueryState>()
const listeners = new Set<() => void>()

const notify = () => {
  for (const listener of listeners) listener()
}

export const loadCatalogState = (profileId: string, kind: CatalogKind): CatalogQueryState => {
  const key = catalogStateKey(profileId, kind)
  const cached = known.get(key)
  if (cached !== undefined) return cached
  const state = readStoredJson(key, parseCatalogState) ?? defaultCatalogState
  known.set(key, state)
  return state
}

export const saveCatalogState = (
  profileId: string,
  kind: CatalogKind,
  state: CatalogQueryState,
): void => {
  const key = catalogStateKey(profileId, kind)
  known.set(key, state)
  writeStoredJson(key, state)
  notify()
}

export const saveArrivalState = (
  profileId: string,
  kind: CatalogKind,
  search: CatalogSearch,
): void =>
  saveCatalogState(profileId, kind, arrivalState(loadCatalogState(profileId, kind), search))

const onStorage = () => {
  known.clear()
  notify()
}

const subscribe = (listener: () => void) => {
  if (listeners.size === 0) window.addEventListener('storage', onStorage)
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) window.removeEventListener('storage', onStorage)
  }
}

export const useCatalogState = (profileId: string, kind: CatalogKind): CatalogQueryState =>
  useSyncExternalStore(subscribe, () => loadCatalogState(profileId, kind))
