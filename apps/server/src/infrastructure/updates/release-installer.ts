import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'

import { appError, type AppError, err, ok, type Result } from '@projo/shared'

import type { DataPaths } from '../../core/data-paths.ts'
import type { Logger } from '../../core/logger.ts'
import { byVersionDescending, parseSemVer } from '../../core/updates/semver.ts'
import {
  RELEASE_MANIFEST_NAME,
  type InstallReleaseError,
  type Release,
  type ReleaseInstaller,
  type ReleaseManifest,
  type SwitchReport,
} from '../../core/updates/update.ts'
import { type FetchLike, httpGet, parseJsonBytes, readBytes } from './http.ts'
import { RELEASE_DOWNLOAD_PREFIX } from './github-release-source.ts'
import {
  isReleaseDownloadUrl,
  isSafeBundlePath,
  parseChecksums,
  parseReleaseManifest,
  parseSwitchReport,
} from './release-files.ts'

/** A bundle is a few MB; anything this large is not a projo release (disk filling guard). */
const MAX_ARCHIVE_BYTES = 512 * 1024 ** 2
const SMALL_FILE_TIMEOUT_MS = 30_000
/** Whole archive download. */
const ARCHIVE_TIMEOUT_MS = 10 * 60_000

export type FsReleaseInstallerConfig = {
  paths: DataPaths['app']
  /** Allowed prefix of asset URLs (§20); tests point it at their server. */
  downloadPrefix?: string
  fetch?: FetchLike
  logger: Logger
}

type Fail = AppError<InstallReleaseError['code']>

const describe = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause)

const fail = <Code extends InstallReleaseError['code']>(
  code: Code,
  message: string,
  context: Record<string, unknown> = {},
  cause?: unknown,
) => err(appError(code, message, { context, ...(cause === undefined ? {} : { cause }) }))

const sha256OfFile = async (path: string): Promise<string | undefined> => {
  try {
    const hasher = new Bun.CryptoHasher('sha256')
    for await (const chunk of Bun.file(path).stream()) hasher.update(chunk)
    return hasher.digest('hex')
  } catch {
    return undefined
  }
}

/** First file of the manifest that is missing or differs, if any. */
const findCorrupted = async (
  dir: string,
  manifest: ReleaseManifest,
): Promise<{ path: string; reason: 'missing' | 'hash_mismatch' } | undefined> => {
  for (const [path, expected] of Object.entries(manifest.files)) {
    const actual = await sha256OfFile(join(dir, ...path.split('/')))
    if (actual !== expected)
      return { path, reason: actual === undefined ? 'missing' : 'hash_mismatch' }
  }
  return undefined
}

const readManifestIn = async (dir: string): Promise<ReleaseManifest | undefined> => {
  try {
    const parsed = parseReleaseManifest(
      JSON.parse(await readFile(join(dir, RELEASE_MANIFEST_NAME), 'utf8')),
    )
    return parsed.ok ? parsed.manifest : undefined
  } catch {
    return undefined
  }
}

/**
 * §16.4 "Update" on the disk (`/data/app`): download into `staging/<v>`, `SHA256SUMS`
 * then every file of the manifest (§20), extraction with Bun's own tar reader (no native
 * dependency), rename into `versions/<v>`. Also `pending` and the supervisor's report.
 */
export const createFsReleaseInstaller = (config: FsReleaseInstallerConfig): ReleaseInstaller => {
  const { paths } = config
  const downloadPrefix = config.downloadPrefix ?? RELEASE_DOWNLOAD_PREFIX
  const doFetch: FetchLike = config.fetch ?? ((input, init) => fetch(input, init))
  const log = config.logger.child({ module: 'updates' })
  /** `versions/<v>` never changes once installed: checked once per directory mtime. */
  const verified = new Map<string, { mtimeMs: number; manifest: ReleaseManifest | undefined }>()

  const checkVersionDir = async (version: string): Promise<ReleaseManifest | undefined> => {
    const dir = join(paths.versions, version)
    const mtimeMs = await stat(dir).then(
      (stats) => (stats.isDirectory() ? stats.mtimeMs : undefined),
      () => undefined,
    )
    if (mtimeMs === undefined) return undefined
    const cached = verified.get(version)
    if (cached !== undefined && cached.mtimeMs === mtimeMs) return cached.manifest
    const manifest = await readManifestIn(dir)
    const valid =
      manifest !== undefined &&
      manifest.version === version &&
      (await findCorrupted(dir, manifest)) === undefined
    verified.set(version, { mtimeMs, manifest: valid ? manifest : undefined })
    return valid ? manifest : undefined
  }

  const downloadSums = async (
    release: Release,
    signal: AbortSignal,
  ): Promise<Result<Map<string, string>, Fail>> => {
    const outcome = await httpGet({
      fetch: doFetch,
      url: release.checksums.url,
      timeoutMs: SMALL_FILE_TIMEOUT_MS,
      signal,
    })
    if (outcome.kind === 'network_error')
      return fail('update/download_failed', 'cannot download SHA256SUMS', {
        reason: outcome.message,
      })
    if (!outcome.response.ok)
      return fail('update/download_failed', 'SHA256SUMS answered an error', {
        status: outcome.response.status,
      })
    const bytes = await readBytes(outcome.response)
    if (bytes === undefined) return fail('update/download_failed', 'SHA256SUMS was cut short')
    return ok(parseChecksums(new TextDecoder().decode(bytes)))
  }

  /** Streams the archive to `file`, hashing on the way; resolves with its SHA-256. */
  const downloadArchive = async ({
    release,
    file,
    signal,
    onProgress,
  }: {
    release: Release
    file: string
    signal: AbortSignal
    onProgress: (percent: number) => void
  }): Promise<Result<string, Fail>> => {
    const outcome = await httpGet({
      fetch: doFetch,
      url: release.archive.url,
      timeoutMs: ARCHIVE_TIMEOUT_MS,
      signal,
    })
    if (outcome.kind === 'network_error')
      return fail('update/download_failed', 'cannot download the archive', {
        reason: outcome.message,
      })
    const { response } = outcome
    if (!response.ok || !response.body)
      return fail('update/download_failed', 'archive answered an error', {
        status: response.status,
      })
    const total = Number(response.headers.get('content-length')) || release.archive.sizeBytes
    if (total > MAX_ARCHIVE_BYTES)
      return fail('update/invalid_release', 'archive is too large', { sizeBytes: total })
    const hasher = new Bun.CryptoHasher('sha256')
    const writer = Bun.file(file).writer()
    let received = 0
    try {
      for await (const chunk of response.body) {
        received += chunk.byteLength
        if (received > MAX_ARCHIVE_BYTES)
          return fail('update/invalid_release', 'archive is too large', { sizeBytes: received })
        hasher.update(chunk)
        writer.write(chunk)
        if (total > 0) onProgress(Math.min(99, (received / total) * 100))
      }
    } catch (cause) {
      return fail('update/download_failed', 'archive download was interrupted', {
        reason: describe(cause),
      })
    } finally {
      await writer.end()
    }
    return ok(hasher.digest('hex'))
  }

  /** Writes every regular file of the archive under `dir`, refusing paths that leave it. */
  const extract = async (archiveFile: string, dir: string): Promise<Result<void, Fail>> => {
    const root = resolve(dir)
    let entries: Map<string, File>
    try {
      entries = await new Bun.Archive(await Bun.file(archiveFile).bytes()).files()
    } catch (cause) {
      return fail('update/invalid_release', 'archive is not a valid tar.gz', {}, cause)
    }
    for (const name of entries.keys()) {
      const path = name.replace(/^(\.\/)+/u, '')
      const target = resolve(root, ...path.split('/'))
      if (!isSafeBundlePath(path) || !target.startsWith(root + sep))
        return fail('update/invalid_release', 'archive entry escapes the bundle', { entry: name })
    }
    try {
      for (const [name, file] of entries) {
        const path = name.replace(/^(\.\/)+/u, '')
        await Bun.write(resolve(root, ...path.split('/')), file, { createPath: true })
      }
      return ok(undefined)
    } catch (cause) {
      return fail('update/install_failed', 'cannot extract the archive', {}, cause)
    }
  }

  const install: ReleaseInstaller['install'] = async ({ release, signal, onProgress }) => {
    const { version } = release
    if (parseSemVer(version) === undefined || version.includes('/'))
      return fail('update/invalid_release', 'release version is not semver', { version })
    const foreign = [release.archive, release.checksums].find(
      (asset) => !isReleaseDownloadUrl(asset.url, downloadPrefix),
    )
    if (foreign !== undefined)
      return fail('update/invalid_release', 'release file is not hosted on the projo releases', {
        asset: foreign.name,
      })

    const staging = join(paths.staging, version)
    const archiveFile = join(staging, release.archive.name)
    const bundleDir = join(staging, 'bundle')
    const run = async (): Promise<Result<ReleaseManifest, Fail>> => {
      try {
        await rm(staging, { recursive: true, force: true })
        await mkdir(bundleDir, { recursive: true })
      } catch (cause) {
        return fail('update/install_failed', 'cannot prepare the staging directory', {}, cause)
      }
      const sums = await downloadSums(release, signal)
      if (!sums.ok) return sums
      const expected = sums.value.get(release.archive.name)
      if (expected === undefined)
        return fail('update/invalid_release', 'SHA256SUMS does not list the archive', { version })

      const actual = await downloadArchive({ release, file: archiveFile, signal, onProgress })
      if (!actual.ok) return actual
      if (signal.aborted) return fail('update/download_failed', 'update aborted', { version })
      if (actual.value !== expected)
        return fail('update/checksum_mismatch', 'archive does not match SHA256SUMS', {
          version,
          file: release.archive.name,
        })

      const extracted = await extract(archiveFile, bundleDir)
      if (!extracted.ok) return extracted
      const manifest = await readManifestIn(bundleDir)
      if (manifest === undefined)
        return fail('update/invalid_release', 'archive has no valid manifest.json', { version })
      if (manifest.version !== version)
        return fail('update/invalid_release', 'manifest version differs from the release', {
          version,
          manifestVersion: manifest.version,
        })
      const corrupted = await findCorrupted(bundleDir, manifest)
      if (corrupted !== undefined)
        return fail('update/checksum_mismatch', 'file does not match the manifest', {
          version,
          file: corrupted.path,
          reason: corrupted.reason,
        })

      const target = join(paths.versions, version)
      try {
        await mkdir(paths.versions, { recursive: true })
        await rm(target, { recursive: true, force: true })
        await rename(bundleDir, target)
      } catch (cause) {
        return fail(
          'update/install_failed',
          'cannot move the version into place',
          { version },
          cause,
        )
      }
      verified.delete(version)
      onProgress(100)
      log.info('release installed', { version })
      return ok(manifest)
    }
    const result = await run()
    await rm(staging, { recursive: true, force: true }).catch(() => undefined)
    return result
  }

  return {
    install,

    installed: async () => {
      const names = await readdir(paths.versions).catch((): string[] => [])
      const versions = names.filter((name) => parseSemVer(name) !== undefined)
      const checked = await Promise.all(
        versions.map(async (version) => ({ version, manifest: await checkVersionDir(version) })),
      )
      return checked
        .flatMap(({ version, manifest }) => (manifest === undefined ? [] : [{ version, manifest }]))
        .sort((a, b) => byVersionDescending(a.version, b.version))
    },

    writePending: async (version) => {
      const tmp = `${paths.pending}.tmp`
      try {
        await writeFile(tmp, `${version}\n`, 'utf8')
        await rename(tmp, paths.pending)
        return ok(undefined)
      } catch (cause) {
        return err(
          appError('update/install_failed', 'cannot write the pending switch', {
            context: { version },
            cause,
          }),
        )
      }
    },

    takeSwitchReport: async (): Promise<SwitchReport | undefined> => {
      const bytes = await readFile(paths.switchResult).then(
        (content) => new Uint8Array(content),
        () => undefined,
      )
      if (bytes === undefined) return undefined
      await rm(paths.switchResult, { force: true }).catch(() => undefined)
      const report = parseSwitchReport(parseJsonBytes(bytes))
      if (report === undefined) log.warn('ignored an invalid switch report')
      return report
    },
  }
}
