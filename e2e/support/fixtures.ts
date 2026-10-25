import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { type APIRequestContext, test as base } from '@playwright/test'

import { admin, apiSignIn } from './accounts.ts'
import { ensurePlaybackLibrary, type PlaybackLibrary } from './playback.ts'
import { e2eRoot, incomingDirOf, libraryDirOf, playbackDirOf, type ServerName } from './paths.ts'

/** Set per project in the Playwright config: which server (and folders) a browser works on. */
export type ServerOptions = { serverName: ServerName }

type ServerFolders = {
  /** The library folder this server's admin added in the wizard (parcours 1). */
  libraryDir: string
  /** Files staged outside the library, moved in by a journey (journey 5). */
  incomingDir: string
  /** Root of the "Playback" library of the M3 journeys. */
  playbackDir: string
  /**
   * Storage state (file) of an admin session of this server, signed in once and shared by the
   * journeys and projects that use it: the server allows 10 logins per 15 min per IP (§20), and
   * every journey comes from 127.0.0.1.
   */
  adminState: string
  /** An API context signed in as the admin (`adminState`). */
  adminRequest: APIRequestContext
  /**
   * The "Playback" library, added by the admin on first use (`ensurePlaybackLibrary`): item and
   * source ids of every M3 fixture, all sources ready.
   */
  playbackLibrary: PlaybackLibrary
}

export const test = base.extend<ServerFolders, ServerOptions>({
  serverName: ['chromium', { option: true, scope: 'worker' }],
  libraryDir: async ({ serverName }, provide) => provide(libraryDirOf(serverName)),
  incomingDir: async ({ serverName }, provide) => provide(incomingDirOf(serverName)),
  playbackDir: async ({ serverName }, provide) => provide(playbackDirOf(serverName)),
  adminState: async ({ playwright, baseURL, serverName }, provide) => {
    const file = join(e2eRoot, `admin-${serverName}.json`)
    const options = baseURL === undefined ? {} : { baseURL }
    // A file from a previous run holds a session of a data dir that no longer exists.
    const stillSignedIn = async () => {
      if (!existsSync(file)) return false
      const api = await playwright.request.newContext({ ...options, storageState: file })
      const signedIn = (await api.get('/api/v1/auth/me')).ok()
      await api.dispose()
      return signedIn
    }
    if (!(await stillSignedIn())) {
      const api = await playwright.request.newContext(options)
      await apiSignIn(api, admin)
      await api.storageState({ path: file })
      await api.dispose()
    }
    await provide(file)
  },
  adminRequest: async ({ playwright, baseURL, adminState }, provide) => {
    const api = await playwright.request.newContext({
      ...(baseURL === undefined ? {} : { baseURL }),
      storageState: adminState,
    })
    await provide(api)
    await api.dispose()
  },
  // Its first use waits for the scan of the library: its own timeout, not the test's.
  playbackLibrary: [
    async ({ adminRequest, playbackDir }, provide) => {
      await provide(await ensurePlaybackLibrary(adminRequest, playbackDir))
    },
    { timeout: 120_000 },
  ],
})

export { expect } from '@playwright/test'
