import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query'

import { isProfileLost, isSessionLost, toApiFailure } from '../shared/api/failure.ts'
import { getActiveProfileId } from '../shared/session/active-profile.ts'

/**
 * Query client of the app. Any call answered "session lost" (expired, revoked, disabled) sends
 * the user back to the login screen through `onSessionLost`; one refusing the active profile
 * (PIN unlocked for another tab's profile, profile deleted) back to "Who's watching?" through
 * `onProfileLost`. Only network and 5xx failures are retried.
 */
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
