import { fileURLToPath } from 'node:url'

import { e2eRoot } from './paths.ts'

export const runtimeImage: string = process.env['PROJO_E2E_RUNTIME_IMAGE'] ?? ''

const repoRoot = fileURLToPath(new URL('../..', import.meta.url)).replace(/\/$/, '')
const mounts = [repoRoot, ...(e2eRoot.startsWith(`${repoRoot}/`) ? [] : [e2eRoot])]

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
