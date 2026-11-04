import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { appDir, dataDir, port } from '../support/paths.ts'
import { dockerRun, runtimeImage } from '../support/runtime-image.ts'

const entry = join(appDir, 'server.js')
if (!existsSync(entry)) {
  console.error(`e2e: ${entry} is missing, build it first (bun run e2e does)`)
  process.exit(1)
}

rmSync(dataDir, { recursive: true, force: true })
mkdirSync(dataDir, { recursive: true })

const tmdbRedirect = resolve(import.meta.dir, '../support/tmdb-redirect.ts')

const serverEnv = {
  PORT: String(port),
  DATA_DIR: dataDir,
  LOG_LEVEL: process.env['PROJO_E2E_LOG_LEVEL'] ?? 'warn',
}

const command =
  runtimeImage === ''
    ? ['bun', '--preload', tmdbRedirect, entry]
    : [
        ...dockerRun('bun', [
          '--init',
          '--network',
          'host',
          '--workdir',
          appDir,
          ...Object.entries({ ...serverEnv, HOME: '/tmp' }).flatMap(([key, value]) => [
            '--env',
            `${key}=${value}`,
          ]),
        ]),
        '--preload',
        tmdbRedirect,
        entry,
      ]

const server = Bun.spawn({
  cmd: command,
  cwd: appDir,
  env: { ...process.env, ...serverEnv },
  stdout: 'inherit',
  stderr: 'inherit',
})

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => server.kill(signal))
}

process.exit(await server.exited)
