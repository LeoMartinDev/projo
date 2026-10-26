import { all, fromPromise, map, type Result } from '@projo/shared/result'
import { deleteItemAsync, getItemAsync, setItemAsync } from 'expo-secure-store'

import { type Failure, failure } from '../../shared/api/failure.ts'

const tokenKey = 'projo.token'
const profileKey = 'projo.profile-id'

export type StoredSession = { readonly token?: string; readonly profileId?: string }

/**
 * The device's bearer token (§26.3) and the last profile used on it (§13.6), in the Keychain.
 * Both belong to the stored server: changing server clears them.
 */
export type SessionStore = {
  /** Empty when nothing is stored, or when the Keychain cannot be read. */
  load: () => Promise<StoredSession>
  saveToken: (token: string) => Promise<Result<void, Failure<'unknown'>>>
  saveProfileId: (profileId: string) => Promise<Result<void, Failure<'unknown'>>>
  clearToken: () => Promise<Result<void, Failure<'unknown'>>>
  /** Token and profile: the device forgets the server's account. */
  clear: () => Promise<Result<void, Failure<'unknown'>>>
}

const storageError = (cause: unknown) => failure('unknown', 'session storage failed', { cause })

const read = async (key: string): Promise<string | undefined> => {
  const stored = await fromPromise(() => getItemAsync(key), storageError)
  return stored.ok ? (stored.value ?? undefined) : undefined
}

const remove = (key: string) => fromPromise(() => deleteItemAsync(key), storageError)

export const secureSessionStore: SessionStore = {
  load: async () => {
    const [token, profileId] = await Promise.all([read(tokenKey), read(profileKey)])
    return {
      ...(token === undefined ? {} : { token }),
      ...(profileId === undefined ? {} : { profileId }),
    }
  },
  saveToken: (token) => fromPromise(() => setItemAsync(tokenKey, token), storageError),
  saveProfileId: (profileId) =>
    fromPromise(() => setItemAsync(profileKey, profileId), storageError),
  clearToken: () => remove(tokenKey),
  clear: async () => map(all(await Promise.all([remove(tokenKey), remove(profileKey)])), () => {}),
}
