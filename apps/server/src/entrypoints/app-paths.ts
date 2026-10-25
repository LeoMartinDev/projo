import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

import rootPackage from '../../../../package.json' with { type: 'json' }

/**
 * Where the code runs from. In the release bundle (runtime/README.md) everything sits next to
 * `server.js`: `drizzle/` (migrations), `public/` (web), `manifest.json`. In the repo, the
 * migrations are in `apps/server/drizzle` and the web build in `apps/web/dist`.
 */
export type AppPaths = {
  bundled: boolean
  appDir: string
  migrationsDir: string
  webDir: string
  manifestFile: string | undefined
}

export const resolveAppPaths = (entryDir: string = import.meta.dir): AppPaths => {
  const bundled = existsSync(join(entryDir, 'drizzle', 'meta', '_journal.json'))
  if (bundled) {
    return {
      bundled,
      appDir: entryDir,
      migrationsDir: join(entryDir, 'drizzle'),
      webDir: join(entryDir, 'public'),
      manifestFile: join(entryDir, 'manifest.json'),
    }
  }
  const serverDir = resolve(entryDir, '../..')
  return {
    bundled,
    appDir: serverDir,
    migrationsDir: join(serverDir, 'drizzle'),
    webDir: resolve(serverDir, '../web/dist'),
    manifestFile: undefined,
  }
}

/** Fallback version (dev); the bundle reads `manifest.json` instead. */
export const sourceVersion: string = rootPackage.version
