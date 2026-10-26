import { focusManager, QueryClient } from '@tanstack/react-query'
import { AppState, type AppStateStatus } from 'react-native'

/**
 * Coming back to the foreground counts as a window focus: stale queries refetch (§26.4, §26.5:
 * no SSE outside the player).
 */
focusManager.setEventListener((setFocused) => {
  const subscription = AppState.addEventListener('change', (state: AppStateStatus) =>
    setFocused(state === 'active'),
  )
  return () => subscription.remove()
})

export const createAppQueryClient = () =>
  new QueryClient({ defaultOptions: { queries: { staleTime: 30_000 } } })
