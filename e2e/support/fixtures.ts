import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { type APIRequestContext, test as base } from '@playwright/test'

import { admin, apiSignIn } from './accounts.ts'
import { ensurePlaybackLibrary, type PlaybackLibrary } from './playback.ts'
import { e2eRoot, incomingDir, libraryDir, playbackDir } from './paths.ts'

type ServerFixtures = {
  libraryDir: string
  incomingDir: string
  playbackDir: string
  adminState: string
  adminRequest: APIRequestContext
  playbackLibrary: PlaybackLibrary
}

export const test = base.extend<ServerFixtures>({
  libraryDir: async ({}, provide) => provide(libraryDir),
  incomingDir: async ({}, provide) => provide(incomingDir),
  playbackDir: async ({}, provide) => provide(playbackDir),
  adminState: async ({ playwright, baseURL }, provide) => {
    const file = join(e2eRoot, 'admin.json')
    const options = baseURL === undefined ? {} : { baseURL }
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
  playbackLibrary: [
    async ({ adminRequest }, provide) => {
      await provide(await ensurePlaybackLibrary(adminRequest, playbackDir))
    },
    { timeout: 120_000 },
  ],
})

export { expect } from '@playwright/test'
