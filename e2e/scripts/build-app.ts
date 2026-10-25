// Builds what the e2e servers run, like production: the web app, then the release bundle
// (server.js + public/ + drizzle/, runtime/README.md) into `<e2e root>/app`.
import { resolve } from 'node:path'

import { appDir } from '../support/paths.ts'

const rootDir = resolve(import.meta.dir, '../..')

const run = async (cmd: string[]): Promise<void> => {
  const proc = Bun.spawn({ cmd, cwd: rootDir, stdout: 'inherit', stderr: 'inherit' })
  const code = await proc.exited
  if (code !== 0) {
    console.error(`e2e build: \`${cmd.join(' ')}\` exited with ${code}`)
    process.exit(code)
  }
}

await run(['bun', 'run', 'build:web'])
await run(['bun', 'runtime/scripts/build-bundle.ts', '--out', appDir])
