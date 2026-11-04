import type { Result } from '@projo/shared/result'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createContext, type ReactNode, use } from 'react'

import { type Failure, toFailure } from '../../shared/api/failure.ts'
import { secureSessionStore, type SessionStore } from '../session/session-store.ts'
import { type CheckServer, checkServerFactory, type ServerStatus } from './check-server.ts'
import { minimumServerVersion } from './compatibility.ts'
import type { ConnectionError } from './connection-error.ts'
import { type ConnectionGate, connectionGate } from './connection-gate.ts'
import { normalizeServerUrl } from './server-url.ts'
import { secureServerUrlStore, type ServerUrlStore } from './server-url-store.ts'

const checkServer = checkServerFactory({
  fetch: (url, init) => fetch(url, init),
  minimumServerVersion,
  timeoutMs: 10_000,
})

const storedUrlKey = ['server-url'] as const
const healthKey = (url: string) => ['server-health', url] as const
export const sessionQueryPrefix = 'session'

export const unwrap = async <T, E>(result: Promise<Result<T, E>> | Result<T, E>): Promise<T> => {
  const settled = await result
  if (!settled.ok) throw settled.error
  return settled.value
}

type ServerConnection = {
  gate: ConnectionGate
  connect: (input: string) => void
  connecting: boolean
  connectError?: Failure
  recheck: () => void
  rechecking: boolean
  forget: () => void
  check: CheckServer
  adopt: (url: string, status: ServerStatus) => Promise<Result<void, ConnectionError<'unknown'>>>
}

const ServerConnectionContext = createContext<ServerConnection | undefined>(undefined)

export const ServerConnectionProvider = ({
  children,
  store = secureServerUrlStore,
  sessionStore = secureSessionStore,
}: {
  children: ReactNode
  store?: ServerUrlStore
  sessionStore?: SessionStore
}) => {
  const queryClient = useQueryClient()

  const stored = useQuery({
    queryKey: storedUrlKey,
    queryFn: async (): Promise<{ url?: string }> => {
      const url = await store.load()
      return url === undefined ? {} : { url }
    },
    staleTime: Infinity,
  })
  const url = stored.data?.url

  const health = useQuery({
    queryKey: healthKey(url ?? ''),
    queryFn: () => unwrap(checkServer(url ?? '')),
    enabled: url !== undefined,
    staleTime: 0,
    retry: false,
  })

  const connect = useMutation({
    mutationFn: async (input: string): Promise<{ url: string; status: ServerStatus }> => {
      const normalized = await unwrap(normalizeServerUrl(input))
      const status = await unwrap(checkServer(normalized))
      if (normalized !== url) await unwrap(sessionStore.clear())
      await unwrap(store.save(normalized))
      return { url: normalized, status }
    },
    onSuccess: ({ url: connected, status }) => {
      if (connected !== url) queryClient.removeQueries({ queryKey: [sessionQueryPrefix] })
      queryClient.setQueryData(healthKey(connected), status)
      queryClient.setQueryData(storedUrlKey, { url: connected })
    },
  })

  const forget = useMutation({
    mutationFn: async () => {
      await unwrap(sessionStore.clear())
      await unwrap(store.clear())
    },
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: ['server-health'] })
      queryClient.removeQueries({ queryKey: [sessionQueryPrefix] })
      queryClient.setQueryData(storedUrlKey, {})
      connect.reset()
    },
  })

  const adopt = async (adopted: string, status: ServerStatus) => {
    const saved = await store.save(adopted)
    if (saved.ok) {
      queryClient.setQueryData(healthKey(adopted), status)
      queryClient.setQueryData(storedUrlKey, { url: adopted })
      connect.reset()
    }
    return saved
  }

  const healthError = health.error ?? undefined
  const gate = connectionGate({
    stored: { loaded: stored.isSuccess, url },
    health: {
      status: health.data,
      error: healthError === undefined ? undefined : toFailure(healthError),
    },
  })
  const connectError = connect.error ?? undefined

  const value: ServerConnection = {
    gate,
    connect: connect.mutate,
    connecting: connect.isPending,
    ...(connectError === undefined ? {} : { connectError: toFailure(connectError) }),
    recheck: () => void health.refetch(),
    rechecking: health.isFetching,
    forget: () => forget.mutate(),
    check: checkServer,
    adopt,
  }
  return <ServerConnectionContext value={value}>{children}</ServerConnectionContext>
}

export const useServerConnection = (): ServerConnection => {
  const connection = use(ServerConnectionContext)
  if (connection === undefined)
    throw new Error('useServerConnection outside ServerConnectionProvider')
  return connection
}
