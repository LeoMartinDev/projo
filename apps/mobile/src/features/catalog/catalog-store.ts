import { fromPromise } from '@projo/shared/result'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getItemAsync, setItemAsync } from 'expo-secure-store'

import {
  type CatalogQueryState,
  catalogStateKey,
  defaultCatalogState,
  parseCatalogState,
} from '@projo/shared/api/catalog-state'

import { failure } from '../../shared/api/failure.ts'
import { sessionQueryPrefix } from '../server-connection/ServerConnection.tsx'
import { useSession } from '../session/Session.tsx'
import type { CatalogKind } from './queries.ts'

const storageError = (cause: unknown) =>
  failure('unknown', 'catalog state storage failed', { cause })

const load = async (key: string): Promise<CatalogQueryState> => {
  const stored = await fromPromise(() => getItemAsync(key), storageError)
  const text = stored.ok ? (stored.value ?? undefined) : undefined
  if (text === undefined) return defaultCatalogState
  const json = await fromPromise(async () => JSON.parse(text) as unknown, storageError)
  return json.ok ? parseCatalogState(json.value) : defaultCatalogState
}

/**
 * Sort and filters of Movies / Shows, kept per profile and per device (§13.4), in the Keychain
 * (the app's only store; a few bytes). `state` is undefined until read: the grid waits for it
 * rather than loading the default order first.
 */
export const useCatalogState = (kind: CatalogKind) => {
  const queryClient = useQueryClient()
  const { gate } = useSession()
  const key = catalogStateKey(gate.kind === 'ready' ? gate.profile.id : 'none', kind)
  const queryKey = [sessionQueryPrefix, 'catalog-state', key]
  const stored = useQuery({ queryKey, queryFn: () => load(key), staleTime: Infinity })
  return {
    state: stored.data,
    change: (next: CatalogQueryState) => {
      queryClient.setQueryData(queryKey, next)
      // Not kept (Keychain unavailable): the next launch shows the default order, nothing worse.
      void fromPromise(() => setItemAsync(key, JSON.stringify(next)), storageError)
    },
  }
}
