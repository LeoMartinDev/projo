import { mkdirSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const resolveRoot = (): string => {
  const root = process.env['PROJO_E2E_DIR'] ?? fileURLToPath(new URL('../tmp', import.meta.url))
  mkdirSync(root, { recursive: true })
  return realpathSync(root)
}

export const e2eRoot: string = resolveRoot()

export const appDir: string = join(e2eRoot, 'app')

export const mediaDir: string = join(e2eRoot, 'media')

export const port = 4801

export const baseUrl = `http://127.0.0.1:${port}`

export const dataDir: string = join(e2eRoot, 'data')

export const libraryDir: string = join(e2eRoot, 'library')

export const incomingDir: string = join(e2eRoot, 'incoming')

export const playbackDir: string = join(e2eRoot, 'playback')
