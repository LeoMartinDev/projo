import type { Result } from '@projo/shared/result'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createContext, type ReactNode, use, useMemo } from 'react'

import { type ApiClient, createApiClient } from '../../shared/api/client.ts'
import { checkServerFactory, type ServerStatus } from './check-server.ts'
import { minimumServerVersion } from './compatibility.ts'
import { type ConnectionError, toConnectionError } from './connection-error.ts'
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

/** TanStack Query wants a rejection: the `Err` of a `Result` becomes one, as is. */
const unwrap = async <T, E>(result: Promise<Result<T, E>> | Result<T, E>): Promise<T> => {
  const settled = await result
  if (!settled.ok) throw settled.error
  return settled.value
}

type ServerConnection = {
  gate: ConnectionGate
  /** Typed client of the connected server's `/api/v1`. */
  api?: ApiClient
  connect: (input: string) => void
  connecting: boolean
  connectError?: ConnectionError
  recheck: () => void
  rechecking: boolean
  forget: () => void
}

const ServerConnectionContext = createContext<ServerConnection | undefined>(undefined)

/**
 * The server the app talks to: its URL (kept on the device), and its `/health`, checked at launch
 * and on every return to the foreground (§26.4).
 */
export const ServerConnectionProvider = ({
  children,
  store = secureServerUrlStore,
}: {
  children: ReactNode
  store?: ServerUrlStore
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
      await unwrap(store.save(normalized))
      return { url: normalized, status }
    },
    onSuccess: ({ url: connected, status }) => {
      queryClient.setQueryData(healthKey(connected), status)
      queryClient.setQueryData(storedUrlKey, { url: connected })
    },
  })

  const forget = useMutation({
    mutationFn: () => unwrap(store.clear()),
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: ['server-health'] })
      queryClient.setQueryData(storedUrlKey, {})
      connect.reset()
    },
  })

  const healthError = health.error ?? undefined
  const gate = connectionGate({
    stored: { loaded: stored.isSuccess, url },
    health: {
      status: health.data,
      error: healthError === undefined ? undefined : toConnectionError(healthError),
    },
  })
  const connectError = connect.error ?? undefined

  const api = useMemo(() => (url === undefined ? undefined : createApiClient(url)), [url])

  const value: ServerConnection = {
    gate,
    ...(api === undefined ? {} : { api }),
    connect: connect.mutate,
    connecting: connect.isPending,
    ...(connectError === undefined ? {} : { connectError: toConnectionError(connectError) }),
    recheck: () => void health.refetch(),
    rechecking: health.isFetching,
    forget: () => forget.mutate(),
  }
  return <ServerConnectionContext value={value}>{children}</ServerConnectionContext>
}

export const useServerConnection = (): ServerConnection => {
  const connection = use(ServerConnectionContext)
  if (connection === undefined)
    throw new Error('useServerConnection outside ServerConnectionProvider')
  return connection
}
