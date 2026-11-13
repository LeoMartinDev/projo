import { useSyncExternalStore } from 'react'

import type { ReadableStore } from '@projo/player/core/store'

export const useStore = <T>(store: ReadableStore<T>): T =>
  useSyncExternalStore(store.subscribe, store.get)
