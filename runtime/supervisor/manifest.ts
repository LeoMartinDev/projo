import { readdir, readFile } from 'node:fs/promises'
import { isAbsolute, join, posix, relative, sep } from 'node:path'
import { supervisorError, type SupervisorError } from './errors'
import { err, ok, type Result } from './result'
import { isSemVer } from './semver'

export const MANIFEST_FILE = 'manifest.json'
export const ENTRY_FILE = 'server.js'

/** Contract of PRODUCT.md §16.2. `files` maps a POSIX relative path to its SHA-256 (hex). */
export type Manifest = {
  version: string
  runtimeMin: string
  builtAt: string
  files: Readonly<Record<string, string>>
}

const SHA256_HEX = /^[0-9a-f]{64}$/

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && !!value && !Array.isArray(value)

/** Manifest paths are POSIX on every platform: normalized with `posix`, never the native `sep`. */
export const isSafeRelativePath = (path: string): boolean => {
  if (path === '' || isAbsolute(path) || posix.isAbsolute(path) || path.includes('\\')) return false
  const normalized = posix.normalize(path)
  return normalized === path && !normalized.split('/').includes('..')
}

export const parseManifest = (
  raw: unknown,
): Result<Manifest, SupervisorError<'app/manifest_invalid'>> => {
  const invalid = (reason: string) =>
    err(supervisorError('app/manifest_invalid', `Invalid manifest: ${reason}`))
  if (!isRecord(raw)) return invalid('not an object')
  const { version, runtimeMin, builtAt, files } = raw
  if (typeof version !== 'string' || !isSemVer(version)) return invalid('version is not semver')
  if (typeof runtimeMin !== 'string' || !isSemVer(runtimeMin))
    return invalid('runtimeMin is not semver')
  if (typeof builtAt !== 'string' || Number.isNaN(Date.parse(builtAt)))
    return invalid('builtAt is not a date')
  if (!isRecord(files)) return invalid('files is not an object')
  const entries = Object.entries(files)
  for (const [path, hash] of entries) {
    if (!isSafeRelativePath(path) || path === MANIFEST_FILE) return invalid(`unsafe path ${path}`)
    if (typeof hash !== 'string' || !SHA256_HEX.test(hash)) return invalid(`bad hash for ${path}`)
  }
  if (!(ENTRY_FILE in files)) return invalid(`${ENTRY_FILE} is not listed`)
  return ok({
    version,
    runtimeMin,
    builtAt,
    files: Object.fromEntries(entries) as Record<string, string>,
  })
}

export const readManifest = async (
  dir: string,
): Promise<Result<Manifest, SupervisorError<'app/manifest_invalid'>>> => {
  const path = join(dir, MANIFEST_FILE)
  try {
    return parseManifest(JSON.parse(await readFile(path, 'utf8')))
  } catch (cause) {
    return err(supervisorError('app/manifest_invalid', 'Cannot read manifest', { path }, cause))
  }
}

export const sha256File = async (path: string): Promise<string> => {
  const hasher = new Bun.CryptoHasher('sha256')
  hasher.update(await Bun.file(path).arrayBuffer())
  return hasher.digest('hex')
}

/** Relative POSIX paths of every regular file under `dir`, sorted. */
export const listFiles = async (dir: string): Promise<string[]> => {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true })
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => relative(dir, join(entry.parentPath, entry.name)).split(sep).join('/'))
    .sort()
}

export const hashTree = async (
  dir: string,
  exclude: readonly string[] = [MANIFEST_FILE],
): Promise<Record<string, string>> => {
  const files = (await listFiles(dir)).filter((path) => !exclude.includes(path))
  const hashes = await Promise.all(
    files.map(async (path) => [path, await sha256File(join(dir, path))] as const),
  )
  return Object.fromEntries(hashes)
}

/** Checks every file listed in the manifest against its SHA-256. Extra files are tolerated. */
export const verifyTree = async (
  dir: string,
  manifest: Manifest,
): Promise<Result<void, SupervisorError<'app/file_corrupted'>>> => {
  for (const [path, expected] of Object.entries(manifest.files)) {
    const actual = await sha256File(join(dir, path)).catch(() => undefined)
    if (actual !== expected) {
      return err(
        supervisorError('app/file_corrupted', 'File does not match manifest', {
          dir,
          path,
          reason: actual === undefined ? 'missing' : 'hash_mismatch',
        }),
      )
    }
  }
  return ok(undefined)
}
