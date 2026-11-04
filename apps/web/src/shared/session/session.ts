import { type QueryClient, queryOptions } from '@tanstack/react-query'

import type { MeResponse, ProfileDto } from '@projo/shared/api/auth'
import type { SetupStatusResponse } from '@projo/shared/api/setup'

import { api, request } from '../api/client.ts'
import { failureFromResponse, networkFailure } from '../api/failure.ts'
import { changeLocale } from '../i18n/index.ts'
import { pickActiveProfile, setActiveProfileId } from './active-profile.ts'

export type SessionState = { status: 'anonymous' } | { status: 'signed_in'; me: MeResponse }

export const setupStatusQuery = queryOptions({
  queryKey: ['setup-status'],
  queryFn: () => request(() => api.setup.status.$get()),
  staleTime: Number.POSITIVE_INFINITY,
})

const fetchSession = async (): Promise<SessionState> => {
  const response = await api.auth.me.$get().catch((cause: unknown): never => {
    throw networkFailure(cause)
  })
  if (!response.ok) {
    if (response.status === 401) return { status: 'anonymous' }
    throw await failureFromResponse(response)
  }
  return { status: 'signed_in', me: await response.json() }
}

export const sessionQuery = queryOptions({
  queryKey: ['session'],
  queryFn: fetchSession,
  staleTime: Number.POSITIVE_INFINITY,
})

export const applyMe = (me: MeResponse): void => {
  const profile = pickActiveProfile(me)
  setActiveProfileId(profile?.id)
  if (profile !== undefined) void changeLocale(profile.uiLocale)
}

export const signedIn = (queryClient: QueryClient, me: MeResponse): void => {
  applyMe(me)
  const state: SessionState = { status: 'signed_in', me }
  queryClient.setQueryData(sessionQuery.queryKey, state)
  queryClient.setQueryData(
    setupStatusQuery.queryKey,
    (previous: SetupStatusResponse | undefined) => ({ ...previous, completed: true }),
  )
}

export const profileSelected = (queryClient: QueryClient, me: MeResponse): void => {
  queryClient.removeQueries({ queryKey: ['catalog'] })
  signedIn(queryClient, me)
}

export const profileUpdated = (queryClient: QueryClient, profile: ProfileDto): void => {
  const previous = queryClient.getQueryData(sessionQuery.queryKey)
  if (previous?.status !== 'signed_in') return
  const me: MeResponse = {
    ...previous.me,
    profiles: previous.me.profiles.map((item) => (item.id === profile.id ? profile : item)),
  }
  if (me.activeProfileId === profile.id) applyMe(me)
  queryClient.setQueryData(sessionQuery.queryKey, { status: 'signed_in', me } as SessionState)
}

export const signedOut = (queryClient: QueryClient): void => {
  setActiveProfileId(undefined)
  queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== 'setup-status' })
  const state: SessionState = { status: 'anonymous' }
  queryClient.setQueryData(sessionQuery.queryKey, state)
}
