// `webServer` command of the Playwright config: `bun scripts/serve.ts <chromium|webkit>`.
// Starts the built bundle (same origin for the API and the web app, as in production) on a
// brand-new DATA_DIR, and forwards the stop signal Playwright sends at the end of the run.
// TMDB is the recorded one of the server tests, preloaded in the server process
// (support/tmdb-redirect.ts): the server itself only gets the env of §5.4.
// With PROJO_E2E_RUNTIME_IMAGE (the CI), the bundle runs in that image (`runtime` target of
// runtime/Dockerfile): the Bun, ffmpeg and ffprobe of production, not the host's. The repository
// and the e2e folder are mounted at their own paths, so every path stays the same.
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { appDir, dataDirOf, e2eRoot, isServerName, servers } from '../support/paths.ts'

const name = process.argv[2] ?? ''
if (!isServerName(name)) {
  console.error(`usage: bun scripts/serve.ts <${Object.keys(servers).join('|')}>`)
  process.exit(2)
}

const entry = join(appDir, 'server.js')
if (!existsSync(entry)) {
  console.error(`e2e: ${entry} is missing, build it first (bun run e2e does)`)
  process.exit(1)
}

const dataDir = dataDirOf(name)
rmSync(dataDir, { recursive: true, force: true })
mkdirSync(dataDir, { recursive: true })

const tmdbRedirect = resolve(import.meta.dir, '../support/tmdb-redirect.ts')

const serverEnv = {
  PORT: String(servers[name].port),
  DATA_DIR: dataDir,
  LOG_LEVEL: process.env['PROJO_E2E_LOG_LEVEL'] ?? 'warn',
}

const runtimeImage = process.env['PROJO_E2E_RUNTIME_IMAGE'] ?? ''
const repoRoot = resolve(import.meta.dir, '../..')
const mounts = [repoRoot, ...(e2eRoot.startsWith(`${repoRoot}/`) ? [] : [e2eRoot])]

const command =
  runtimeImage === ''
    ? ['bun', '--preload', tmdbRedirect, entry]
    : [
        'docker',
        'run',
        '--rm',
        '--init',
        '--network',
        'host',
        '--user',
        `${process.getuid?.() ?? 0}:${process.getgid?.() ?? 0}`,
        '--workdir',
        appDir,
        '--entrypoint',
        'bun',
        ...mounts.flatMap((path) => ['--volume', `${path}:${path}`]),
        ...Object.entries({ ...serverEnv, HOME: '/tmp' }).flatMap(([key, value]) => [
          '--env',
          `${key}=${value}`,
        ]),
        runtimeImage,
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
