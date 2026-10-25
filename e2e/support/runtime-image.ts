import { fileURLToPath } from 'node:url'

import { e2eRoot } from './paths.ts'

/**
 * `PROJO_E2E_RUNTIME_IMAGE` (the CI): the server and the fixtures' ffmpeg run in that image
 * (`runtime` target of runtime/Dockerfile), the Bun, ffmpeg and ffprobe of production. Empty: the
 * host's.
 */
export const runtimeImage: string = process.env['PROJO_E2E_RUNTIME_IMAGE'] ?? ''

// Node (Playwright's global setup) and Bun (scripts/serve.ts) both load this module.
const repoRoot = fileURLToPath(new URL('../..', import.meta.url)).replace(/\/$/, '')
const mounts = [repoRoot, ...(e2eRoot.startsWith(`${repoRoot}/`) ? [] : [e2eRoot])]

/**
 * `docker run` of `entrypoint` in the runtime image, as the host user, with the repository and
 * the e2e folder mounted at their own paths: every path stays the same inside. `options` go
 * before the image (`--env`, `--network`…), the entrypoint's own arguments after these.
 */
export const dockerRun = (entrypoint: string, options: readonly string[] = []): string[] => [
  'docker',
  'run',
  '--rm',
  '--user',
  `${process.getuid?.() ?? 0}:${process.getgid?.() ?? 0}`,
  '--entrypoint',
  entrypoint,
  ...mounts.flatMap((path) => ['--volume', `${path}:${path}`]),
  ...options,
  runtimeImage,
]
