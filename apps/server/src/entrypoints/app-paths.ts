import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

import rootPackage from '../../../../package.json' with { type: 'json' }

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

export const sourceVersion: string = rootPackage.version
