import { fromPromise, type Result } from '@projo/shared/result'
import { deleteItemAsync, getItemAsync, setItemAsync } from 'expo-secure-store'

import { type ConnectionError, connectionError } from './connection-error.ts'

const key = 'projo.server-url'

/** The server URL, kept on the device (Keychain) across launches (§26.3). */
export type ServerUrlStore = {
  /** `undefined` when none is stored, or when the Keychain cannot be read. */
  load: () => Promise<string | undefined>
  save: (url: string) => Promise<Result<void, ConnectionError<'unknown'>>>
  clear: () => Promise<Result<void, ConnectionError<'unknown'>>>
}

const storageError = (cause: unknown) =>
  connectionError('unknown', 'server URL storage failed', { cause })

export const secureServerUrlStore: ServerUrlStore = {
  load: async () => {
    const stored = await fromPromise(() => getItemAsync(key), storageError)
    return stored.ok ? (stored.value ?? undefined) : undefined
  },
  save: (url) => fromPromise(() => setItemAsync(key, url), storageError),
  clear: () => fromPromise(() => deleteItemAsync(key), storageError),
}
