// Packs a built bundle (dist/app/) into the release assets the updater reads (PRODUCT.md §16.2):
//   projo-app-<version>.tar.gz   the bundle at the root of the archive, regular files only
//   manifest.json                byte-identical to the one inside the archive
//   SHA256SUMS                   `sha256sum` format, the archive and manifest.json
// Usage: bun runtime/scripts/package-release.ts [--bundle dist/app] [--out dist/release] [--tag vX.Y.Z]
import { mkdir, readdir, readFile, rm } from 'node:fs/promises'
import { join, relative, resolve, sep } from 'node:path'
import { parseArgs } from 'node:util'
import { MANIFEST_FILE, readManifest, verifyTree, type Manifest } from '../supervisor/manifest'
import { err, ok, type Result } from '../supervisor/result'

export type PackageErrorCode =
  'release/bundle_invalid' | 'release/version_mismatch' | 'release/write_failed'

export type PackageError = {
  code: PackageErrorCode
  message: string
  context?: Record<string, unknown>
  cause?: unknown
}

const packageError = (
  code: PackageErrorCode,
  message: string,
  context?: Record<string, unknown>,
  cause?: unknown,
): PackageError => ({
  code,
  message,
  ...(context === undefined ? {} : { context }),
  ...(cause === undefined ? {} : { cause }),
})

export const CHECKSUMS_FILE = 'SHA256SUMS'

/** Asset name of the archive; the updater looks for exactly this name. */
export const archiveName = (version: string): string => `projo-app-${version}.tar.gz`

export type PackagedRelease = {
  version: string
  manifest: Manifest
  /** Asset name → absolute path, in upload order. */
  assets: Record<string, string>
}

export type PackageReleaseInput = {
  bundleDir: string
  outDir: string
  /** The git tag being released: must be `v<manifest version>`. */
  tag?: string
}

const sha256Hex = (data: Uint8Array): string => {
  const hasher = new Bun.CryptoHasher('sha256')
  hasher.update(data)
  return hasher.digest('hex')
}

type Walk = { files: string[]; others: string[] }

/** POSIX paths of the regular files under `dir`; anything else (links, devices) in `others`. */
const walk = async (dir: string): Promise<Walk> => {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true })
  const toPosix = (entry: { parentPath: string; name: string }) =>
    relative(dir, join(entry.parentPath, entry.name)).split(sep).join('/')
  return {
    files: entries
      .filter((entry) => entry.isFile())
      .map(toPosix)
      .sort(),
    others: entries
      .filter((entry) => !entry.isFile() && !entry.isDirectory())
      .map(toPosix)
      .sort(),
  }
}

/** The bundle must be exactly what its manifest describes: no extra, missing or changed file. */
const checkBundle = async (bundleDir: string): Promise<Result<Manifest, PackageError>> => {
  const manifest = await readManifest(bundleDir)
  if (!manifest.ok) {
    return err(
      packageError('release/bundle_invalid', 'The bundle has no valid manifest.json', {
        bundleDir,
        reason: manifest.error.message,
      }),
    )
  }
  const verified = await verifyTree(bundleDir, manifest.value)
  if (!verified.ok) {
    return err(
      packageError('release/bundle_invalid', 'A bundle file does not match the manifest', {
        ...verified.error.context,
      }),
    )
  }
  const { files, others } = await walk(bundleDir)
  if (others.length > 0) {
    return err(
      packageError('release/bundle_invalid', 'The bundle holds something else than files', {
        entries: others,
      }),
    )
  }
  const listed = new Set([...Object.keys(manifest.value.files), MANIFEST_FILE])
  const extra = files.filter((path) => !listed.has(path))
  if (extra.length > 0) {
    return err(
      packageError('release/bundle_invalid', 'The bundle holds files missing from the manifest', {
        extra,
      }),
    )
  }
  return manifest
}

export const packageRelease = async ({
  bundleDir,
  outDir,
  tag,
}: PackageReleaseInput): Promise<Result<PackagedRelease, PackageError>> => {
  const checked = await checkBundle(bundleDir)
  if (!checked.ok) return checked
  const manifest = checked.value
  const { version } = manifest
  if (tag !== undefined && tag !== `v${version}`) {
    return err(
      packageError('release/version_mismatch', 'The tag does not match the bundle version', {
        tag,
        version,
      }),
    )
  }

  try {
    const manifestBytes = new Uint8Array(await readFile(join(bundleDir, MANIFEST_FILE)))
    const entries: Record<string, Uint8Array> = {}
    for (const path of Object.keys(manifest.files).sort())
      entries[path] = new Uint8Array(await readFile(join(bundleDir, ...path.split('/'))))
    entries[MANIFEST_FILE] = manifestBytes
    const archive = await new Bun.Archive(entries, { compress: 'gzip' }).bytes()

    const archiveFile = archiveName(version)
    const sums = [
      `${sha256Hex(archive)}  ${archiveFile}`,
      `${sha256Hex(manifestBytes)}  ${MANIFEST_FILE}`,
      '',
    ].join('\n')

    await rm(outDir, { recursive: true, force: true })
    await mkdir(outDir, { recursive: true })
    const assets = {
      [archiveFile]: join(outDir, archiveFile),
      [MANIFEST_FILE]: join(outDir, MANIFEST_FILE),
      [CHECKSUMS_FILE]: join(outDir, CHECKSUMS_FILE),
    }
    await Bun.write(join(outDir, archiveFile), archive)
    await Bun.write(join(outDir, MANIFEST_FILE), manifestBytes)
    await Bun.write(join(outDir, CHECKSUMS_FILE), sums)
    return ok({ version, manifest, assets })
  } catch (cause) {
    return err(
      packageError('release/write_failed', 'Cannot write the release files', { outDir }, cause),
    )
  }
}

if (import.meta.main) {
  const rootDir = resolve(import.meta.dir, '../..')
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      bundle: { type: 'string' },
      out: { type: 'string' },
      tag: { type: 'string' },
    },
  })
  const result = await packageRelease({
    bundleDir: resolve(values.bundle ?? join(rootDir, 'dist/app')),
    outDir: resolve(values.out ?? join(rootDir, 'dist/release')),
    ...(values.tag === undefined ? {} : { tag: values.tag }),
  })
  if (!result.ok) {
    console.error(`${result.error.code}: ${result.error.message}`)
    if (result.error.context !== undefined)
      console.error(JSON.stringify(result.error.context, undefined, 2))
    if (result.error.cause !== undefined) console.error(result.error.cause)
    process.exit(1)
  }
  for (const path of Object.values(result.value.assets)) console.log(path)
}
