import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { DeviceType, deviceType, isDevice, modelName } from 'expo-device'
import { createContext, type ReactNode, use, useMemo, useState } from 'react'

import {
  claimPairingResponseSchema,
  loginResponseSchema,
  type MeResponse,
  meResponseSchema,
} from '@projo/shared/api/auth'
import type { ProfileDto } from '@projo/shared/api/profiles'

import { type ApiClient, createApiClient, requestApi } from '../../shared/api/client.ts'
import { getCredentials, setCredentials } from '../../shared/api/credentials.ts'
import { type Failure, failure, toFailure } from '../../shared/api/failure.ts'
import { changeLocale } from '../../shared/i18n/index.ts'
import {
  sessionQueryPrefix,
  unwrap,
  useServerConnection,
} from '../server-connection/ServerConnection.tsx'
import { deviceNameOf } from './device-name.ts'
import { type SessionGate, sessionGate } from './session-gate.ts'
import { secureSessionStore, type SessionStore, type StoredSession } from './session-store.ts'

/** `deviceName` of the sign-in and of the pairing claim (§26.3). */
const deviceName = deviceNameOf({
  modelName: modelName ?? undefined,
  isTablet: deviceType === DeviceType.TABLET,
  isDevice,
})

const storedKey = (url: string) => [sessionQueryPrefix, url, 'stored'] as const
const meKey = (url: string) => [sessionQueryPrefix, url, 'me'] as const

const withoutToken = ({ profileId }: StoredSession): StoredSession =>
  profileId === undefined ? {} : { profileId }

/** The device's session is gone (401, sign-out): back to the sign-in, server URL kept (§26.3). */
const dropToken = async (queryClient: QueryClient, url: string, store: SessionStore) => {
  setCredentials(withoutToken(getCredentials()))
  queryClient.setQueryData(storedKey(url), (previous: StoredSession | undefined) =>
    withoutToken(previous ?? {}),
  )
  queryClient.removeQueries({ queryKey: meKey(url) })
  await store.clearToken()
}

/**
 * A fresh `MeResponse`: its active profile is sent from now on (`X-Profile-Id`), remembered on the
 * device (§13.6) and sets the interface language (§19).
 */
const applyMe = async (me: MeResponse, store: SessionStore) => {
  const previous = getCredentials()
  const profile = me.profiles.find(({ id }) => id === me.activeProfileId)
  setCredentials({
    ...(previous.token === undefined ? {} : { token: previous.token }),
    ...(profile === undefined ? {} : { profileId: profile.id }),
  })
  if (profile === undefined) return
  if (profile.id !== previous.profileId) await store.saveProfileId(profile.id)
  await changeLocale(profile.uiLocale)
}

type Action<Input> = {
  run: (input: Input) => void
  pending: boolean
  error?: Failure
  reset: () => void
}

type Session = {
  gate: SessionGate
  /** Authenticated client of the connected server. */
  api?: ApiClient
  /** Username and password → a bearer token for this device (`POST /auth/login`, `token: true`). */
  signIn: Action<{ username: string; password: string }>
  /** A pairing code of `serverUrl` → a bearer token (`POST /auth/pairings/claim`, §14). */
  pair: Action<{ serverUrl: string; code: string }>
  /** `POST /profiles/:id/select`: the profile becomes this device's (§13.6), PIN checked. */
  selectProfile: Action<{ id: string; pin?: string }>
  /** The account's profiles changed (created, deleted): `GET /auth/me` again. */
  refreshMe: () => Promise<void>
  /** A profile was saved (`PATCH /profiles/:id`): the session shows it, in its language. */
  profileSaved: (profile: ProfileDto) => Promise<void>
  switchProfile: () => void
  cancelSwitch: () => void
  retry: () => void
  retrying: boolean
  signOut: () => void
  signingOut: boolean
  /** Sign out, then forget the server: the connection screen (§26.5 device settings). */
  changeServer: () => void
}

const SessionContext = createContext<Session | undefined>(undefined)

const action = <Input,>(mutation: {
  mutate: (input: Input) => void
  isPending: boolean
  error: unknown
  reset: () => void
}): Action<Input> => {
  const error = mutation.error ?? undefined
  return {
    run: mutation.mutate,
    pending: mutation.isPending,
    ...(error === undefined ? {} : { error: toFailure(error) }),
    reset: mutation.reset,
  }
}

/**
 * The account of the connected server on this device (§26.3): the bearer token kept in the
 * Keychain, `GET /auth/me` at launch and on every return to the foreground, a 401 anywhere back to
 * the sign-in screen.
 */
export const SessionProvider = ({
  children,
  store = secureSessionStore,
}: {
  children: ReactNode
  store?: SessionStore
}) => {
  const queryClient = useQueryClient()
  const connection = useServerConnection()
  const url = connection.gate.kind === 'connected' ? connection.gate.url : undefined
  const [switching, setSwitching] = useState(false)

  const api = useMemo(
    () =>
      url === undefined
        ? undefined
        : createApiClient(url, {
            authenticated: { onUnauthorized: () => void dropToken(queryClient, url, store) },
          }),
    [url, queryClient, store],
  )

  const stored = useQuery({
    queryKey: storedKey(url ?? ''),
    queryFn: async (): Promise<StoredSession> => {
      const session = await store.load()
      setCredentials(session)
      return session
    },
    enabled: url !== undefined,
    staleTime: Infinity,
  })
  const token = stored.data?.token

  const me = useQuery({
    queryKey: [...meKey(url ?? ''), token ?? ''],
    queryFn: async () => {
      if (api === undefined) throw failure('unknown', 'no server')
      const answer = await unwrap(requestApi(() => api.auth.me.$get(), meResponseSchema))
      await applyMe(answer, store)
      return answer
    },
    enabled: api !== undefined && token !== undefined,
    retry: false,
  })

  const keepToken = (serverUrl: string, newToken: string) => {
    setCredentials({ ...getCredentials(), token: newToken })
    queryClient.setQueryData(storedKey(serverUrl), (previous: StoredSession | undefined) => ({
      ...previous,
      token: newToken,
    }))
  }

  const signIn = useMutation({
    mutationFn: async ({ username, password }: { username: string; password: string }) => {
      if (url === undefined) throw failure('unknown', 'no server')
      const login = await unwrap(
        requestApi(
          () =>
            createApiClient(url).auth.login.$post({
              json: { username, password, token: true, deviceName },
            }),
          loginResponseSchema,
        ),
      )
      if (login.token === undefined) throw failure('unknown', 'login answered without a token')
      await unwrap(store.saveToken(login.token))
      return { serverUrl: url, token: login.token }
    },
    onSuccess: ({ serverUrl, token: newToken }) => keepToken(serverUrl, newToken),
  })

  const pair = useMutation({
    mutationFn: async ({ serverUrl, code }: { serverUrl: string; code: string }) => {
      const status = await unwrap(connection.check(serverUrl))
      // Too old for the app: its "Update your projo server" screen; the code stays unused.
      if (status.kind === 'outdated') return unwrap(connection.adopt(serverUrl, status))
      const claimed = await unwrap(
        requestApi(
          () =>
            createApiClient(serverUrl).auth.pairings.claim.$post({ json: { code, deviceName } }),
          claimPairingResponseSchema,
        ),
      )
      await unwrap(store.saveToken(claimed.token))
      keepToken(serverUrl, claimed.token)
      return unwrap(connection.adopt(serverUrl, status))
    },
  })

  const selectProfile = useMutation({
    mutationFn: async ({ id, pin }: { id: string; pin?: string }) => {
      if (api === undefined) throw failure('unknown', 'no server')
      const answer = await unwrap(
        requestApi(
          () =>
            api.profiles[':id'].select.$post({
              param: { id },
              json: pin === undefined ? {} : { pin },
            }),
          meResponseSchema,
        ),
      )
      await applyMe(answer, store)
      return answer
    },
    onSuccess: (answer) => {
      if (url !== undefined) queryClient.setQueryData([...meKey(url), token ?? ''], answer)
      setSwitching(false)
    },
  })

  const signOut = useMutation({
    // The server forgets the token (`POST /auth/logout`); offline, the device forgets it anyway.
    mutationFn: async () => {
      if (api !== undefined) await requestApi(() => api.auth.logout.$post())
    },
    onSettled: async () => {
      setSwitching(false)
      signIn.reset()
      if (url !== undefined) await dropToken(queryClient, url, store)
    },
  })

  const meData = me.data
  const profileSaved = async (profile: ProfileDto) => {
    if (url === undefined || meData === undefined) return
    const answer = {
      ...meData,
      profiles: meData.profiles.map((known) => (known.id === profile.id ? profile : known)),
    }
    queryClient.setQueryData([...meKey(url), token ?? ''], answer)
    await applyMe(answer, store)
  }

  const meError = me.error ?? undefined
  const value: Session = {
    gate: sessionGate({
      stored: { loaded: stored.isSuccess, token },
      me: { data: me.data, error: meError === undefined ? undefined : toFailure(meError) },
      switching,
    }),
    ...(api === undefined ? {} : { api }),
    signIn: action(signIn),
    pair: action(pair),
    selectProfile: action(selectProfile),
    switchProfile: () => {
      selectProfile.reset()
      setSwitching(true)
    },
    cancelSwitch: () => setSwitching(false),
    retry: () => void me.refetch(),
    retrying: me.isFetching,
    refreshMe: async () => {
      await me.refetch()
    },
    profileSaved,
    signOut: () => signOut.mutate(),
    signingOut: signOut.isPending,
    changeServer: () => signOut.mutate(undefined, { onSettled: connection.forget }),
  }
  return <SessionContext value={value}>{children}</SessionContext>
}

export const useSession = (): Session => {
  const session = use(SessionContext)
  if (session === undefined) throw new Error('useSession outside SessionProvider')
  return session
}
