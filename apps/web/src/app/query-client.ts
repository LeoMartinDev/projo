import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query'

import { isProfileLost, isSessionLost, toApiFailure } from '../shared/api/failure.ts'
import { getActiveProfileId } from '../shared/session/active-profile.ts'

export const createAppQueryClient = ({
  onSessionLost,
  onProfileLost,
}: {
  onSessionLost: () => void
  onProfileLost: () => void
}) => {
  const onError = (error: unknown) => {
    const failure = toApiFailure(error)
    if (isSessionLost(failure)) onSessionLost()
    else if (isProfileLost(failure, getActiveProfileId())) onProfileLost()
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
