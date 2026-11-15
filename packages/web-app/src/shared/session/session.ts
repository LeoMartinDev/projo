import { type QueryClient, queryOptions } from '@tanstack/react-query'

import type { LoginResponse, MeResponse, ProfileDto } from '@projo/shared/api/auth'
import type { SetupStatusResponse } from '@projo/shared/api/setup'

import { api, request } from '../api/client.ts'
import { failureFromResponse, networkFailure } from '../api/failure.ts'
import { setMediaKey } from '../api/media.ts'
import { boundHost } from '../host/bound-host.ts'
import type { HostSession } from '../../host.ts'
import { changeLocale } from '../i18n/index.ts'
import { pickActiveProfile, setActiveProfileId } from './active-profile.ts'

export type SessionState = { status: 'anonymous' } | { status: 'signed_in'; me: MeResponse }

export const setupStatusQuery = queryOptions({
  queryKey: ['setup-status'],
  queryFn: () => request(() => api.setup.status.$get()),
  staleTime: Number.POSITIVE_INFINITY,
})

// A token host forgets a token the server no longer takes (or that it signed out).
const dropToken = (): void => {
  const { session } = boundHost()
  if (session.kind === 'token') void session.drop().catch(() => undefined)
}

const fetchSession = async (): Promise<SessionState> => {
  const response = await api.auth.me.$get().catch((cause: unknown): never => {
    throw networkFailure(cause)
  })
  if (!response.ok) {
    if (response.status === 401) {
      setMediaKey(undefined)
      dropToken()
      return { status: 'anonymous' }
    }
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
  if (me.mediaKey !== undefined) setMediaKey(me.mediaKey)
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

// The session is over (signed out, or lost): a token host forgets its token.
export const signedOut = (queryClient: QueryClient): void => {
  setActiveProfileId(undefined)
  setMediaKey(undefined)
  dropToken()
  queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== 'setup-status' })
  const state: SessionState = { status: 'anonymous' }
  queryClient.setQueryData(sessionQuery.queryKey, state)
}

/** What sign-in adds for the host's session (§20): a token host asks for a bearer token. */
export const signInOptions = (session: HostSession): { token?: true; deviceName?: string } =>
  session.kind === 'token' ? { token: true, deviceName: session.deviceName } : {}

/**
 * The account signed in, once the host holds the session: a token host keeps the token, then
 * reads `/auth/me` over it, which adds the media key (§20); the token is dropped again when that
 * read fails, so a half-done sign-in leaves none behind.
 */
export const completeSignIn = async (
  session: HostSession,
  { token, ...me }: LoginResponse,
): Promise<MeResponse> => {
  if (session.kind === 'cookie' || token === undefined) return me
  return adoptToken(session, token)
}

type TokenSession = Extract<HostSession, { kind: 'token' }>

const adoptToken = async (session: TokenSession, token: string): Promise<MeResponse> => {
  await session.keep(token)
  return request(() => api.auth.me.$get()).catch(async (cause: unknown) => {
    await session.drop().catch(() => undefined)
    throw cause
  })
}

/**
 * Sign-in with a pairing code (§14, token hosts: the desktop app, like the mobile app): claims
 * the code with the host's device name, then holds the token it gives like a sign-in's.
 */
export const claimPairing = async (session: TokenSession, code: string): Promise<MeResponse> => {
  const { token } = await request(() =>
    api.auth.pairings.claim.$post({ json: { code, deviceName: session.deviceName } }),
  )
  return adoptToken(session, token)
}
