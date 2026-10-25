import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query'

import { isSessionLost, toApiFailure } from '../shared/api/failure.ts'

/**
 * Query client of the app. Any call answered "session lost" (expired, revoked, disabled) sends
 * the user back to the login screen through `onSessionLost`. Only network and 5xx failures are
 * retried.
 */
export const createAppQueryClient = (onSessionLost: () => void) => {
  const onError = (error: unknown) => {
    if (isSessionLost(toApiFailure(error))) onSessionLost()
  }
  return new QueryClient({
    queryCache: new QueryCache({ onError }),
    mutationCache: new MutationCache({ onError }),
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        retry: (count, error) => count < 2 && (error.code === 'network' || error.status >= 500),
      },
    },
  })
}
