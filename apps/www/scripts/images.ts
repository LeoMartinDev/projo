// Resizes and re-encodes the site's photos (src/photos.ts) into generated/, before `vite` and
// `vite build` (package.json). Bun.Image: no native module. A file is rewritten only when it is
// missing or older than its source or src/photos.ts, so a dev start stays instant.
import { mkdirSync, statSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

import { photoFile, photos, wallFile, wallPhotos, wallTile } from '../src/photos.ts'

const root = resolve(import.meta.dir, '..')
const manifestTime = statSync(resolve(root, 'src/photos.ts')).mtimeMs

const modifiedAt = (path: string) => statSync(path, { throwIfNoEntry: false })?.mtimeMs

const jobs = [
  ...Object.entries(photos).flatMap(([name, photo]) =>
    photo.widths.map((width) => ({
      source: photo.source,
      output: photoFile(name, width),
      width,
      quality: photo.quality,
    })),
  ),
  ...Object.entries(wallPhotos).map(([name, source]) => ({
    source,
    output: wallFile(name),
    width: wallTile.width,
    quality: wallTile.quality,
  })),
]

const stale = jobs.filter(({ source, output }) => {
  const sourceTime = modifiedAt(resolve(root, source))
  if (sourceTime === undefined) throw new Error(`www images: no source file ${source}`)
  const outputTime = modifiedAt(resolve(root, output))
  return outputTime === undefined || outputTime < Math.max(sourceTime, manifestTime)
})

await Promise.all(
  stale.map(async ({ source, output, width, quality }) => {
    const target = resolve(root, output)
    mkdirSync(dirname(target), { recursive: true })
    await new Bun.Image(resolve(root, source))
      .resize(width, undefined, { withoutEnlargement: true })
      .webp({ quality })
      .write(target)
  }),
)

if (stale.length > 0) console.log(`www images: ${stale.length} of ${jobs.length} files written`)
