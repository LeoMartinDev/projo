import { focusManager, QueryClient } from '@tanstack/react-query'
import { AppState, type AppStateStatus } from 'react-native'

focusManager.setEventListener((setFocused) => {
  const subscription = AppState.addEventListener('change', (state: AppStateStatus) =>
    setFocused(state === 'active'),
  )
  return () => subscription.remove()
})

export const createAppQueryClient = () =>
  new QueryClient({ defaultOptions: { queries: { staleTime: 30_000 } } })
