// Writes the desktop release's latest.json (PRODUCT.md §28.10) from the `updater-<platform>.json`
// that package-release.ts left on each platform's runner, gathered in one directory. Every
// platform the app is released for must be there: an update offered to one platform only would
// leave the other behind silently.
//
//   bun apps/desktop/scripts/write-updater-manifest.ts [--dir dist/desktop-release]
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { updaterManifest, updaterPlatforms, type UpdaterEntry } from './updater-manifest.ts'

const fail: (message: string) => never = (message) => {
  console.error(`write-updater-manifest: ${message}`)
  process.exit(1)
}

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: { dir: { type: 'string', default: 'dist/desktop-release' } },
})
const dir = values.dir
const version: unknown = (await Bun.file(join(import.meta.dir, '..', 'package.json')).json())
  .version
if (typeof version !== 'string') fail('apps/desktop/package.json has no version')

const entries: UpdaterEntry[] = []
for (const platform of updaterPlatforms) {
  const file = Bun.file(join(dir, `updater-${platform}.json`))
  if (!(await file.exists())) fail(`updater-${platform}.json is missing from ${dir}`)
  const entry: unknown = await file.json()
  const { fileName, signature } = Object(entry) as Record<string, unknown>
  if (typeof fileName !== 'string' || typeof signature !== 'string' || signature === '')
    fail(`updater-${platform}.json is not a signed entry`)
  entries.push({ platform, fileName, signature })
}

const manifest = updaterManifest({ version, entries, publishedAt: new Date() })
await Bun.write(join(dir, 'latest.json'), `${JSON.stringify(manifest, undefined, 2)}\n`)
console.log(`write-updater-manifest: latest.json for ${updaterPlatforms.join(', ')} in ${dir}`)
