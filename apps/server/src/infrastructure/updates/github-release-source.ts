import { z } from 'zod'

import { appError, err, ok, type Result } from '@projo/shared'

import type { Logger } from '../../core/logger.ts'
import { parseSemVer } from '../../core/updates/semver.ts'
import {
  RELEASE_CHECKSUMS_NAME,
  RELEASE_MANIFEST_NAME,
  releaseArchiveName,
  RELEASES_REPOSITORY,
  type Release,
  type ReleaseAsset,
  type ReleaseSource,
  type ReleaseSourceError,
} from '../../core/updates/update.ts'
import { type FetchLike, httpGet, parseJsonBytes, readBytes } from './http.ts'
import { parseChecksums, parseReleaseManifest, sha256Hex } from './release-files.ts'

export const GITHUB_API_BASE_URL = 'https://api.github.com'
/** §20: release files are downloaded from this prefix only. */
export const RELEASE_DOWNLOAD_PREFIX = `https://github.com/${RELEASES_REPOSITORY}/releases/download/`

const DEFAULT_TIMEOUT_MS = 15_000

const optionalString = z
  .string()
  .nullish()
  .transform((value) => value ?? undefined)

/** The fields of `GET /repos/{owner}/{repo}/releases/latest` the updater reads. */
const githubReleaseSchema = z.object({
  tag_name: z.string(),
  html_url: z.string(),
  body: optionalString,
  published_at: optionalString,
  created_at: z.string(),
  assets: z.array(
    z.object({
      name: z.string(),
      browser_download_url: z.string(),
      size: z.number().int().nonnegative(),
    }),
  ),
})

export type GithubReleaseSourceConfig = {
  /** Injectable for tests (a local server replaying a release). */
  apiBaseUrl?: string
  /** Allowed prefix of asset URLs; tests point it at their server. */
  downloadPrefix?: string
  fetch?: FetchLike
  timeoutMs?: number
  logger: Logger
}

/**
 * §16.4 `check_updates`: the latest release of `LeoMartinDev/projo`, its archive and
 * `SHA256SUMS`, and `runtimeMin` read from the `manifest.json` published next to the archive
 * (checked against `SHA256SUMS`, so the archive is not downloaded to know whether it fits).
 */
export const createGithubReleaseSource = (config: GithubReleaseSourceConfig): ReleaseSource => {
  const apiBase = (config.apiBaseUrl ?? GITHUB_API_BASE_URL).replace(/\/+$/u, '')
  const downloadPrefix = config.downloadPrefix ?? RELEASE_DOWNLOAD_PREFIX
  const doFetch: FetchLike = config.fetch ?? ((input, init) => fetch(input, init))
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const log = config.logger.child({ module: 'updates' })

  const invalid = (message: string, context: Record<string, unknown> = {}) =>
    err(appError('update/invalid_release', message, { context }))
  const unreachable = (message: string, context: Record<string, unknown> = {}) =>
    err(appError('update/check_failed', message, { context }))

  const download = async (asset: ReleaseAsset): Promise<Result<Uint8Array, ReleaseSourceError>> => {
    const outcome = await httpGet({ fetch: doFetch, url: asset.url, timeoutMs })
    if (outcome.kind === 'network_error')
      return unreachable('cannot download a release file', {
        asset: asset.name,
        reason: outcome.message,
      })
    if (!outcome.response.ok)
      return unreachable('release file answered an error', {
        asset: asset.name,
        status: outcome.response.status,
      })
    const bytes = await readBytes(outcome.response)
    return bytes === undefined
      ? unreachable('release file was cut short', { asset: asset.name })
      : ok(bytes)
  }

  return {
    latest: async () => {
      const url = `${apiBase}/repos/${RELEASES_REPOSITORY}/releases/latest`
      const outcome = await httpGet({
        fetch: doFetch,
        url,
        timeoutMs,
        accept: 'application/vnd.github+json',
      })
      if (outcome.kind === 'network_error')
        return unreachable('GitHub is unreachable', { reason: outcome.message })
      const { response } = outcome
      // No release published yet.
      if (response.status === 404) return ok(undefined)
      if (!response.ok) return unreachable('GitHub answered an error', { status: response.status })
      const bytes = await readBytes(response)
      const parsed = githubReleaseSchema.safeParse(
        bytes === undefined ? undefined : parseJsonBytes(bytes),
      )
      if (!parsed.success) return invalid('unexpected GitHub release response')
      const release = parsed.data

      const semver = parseSemVer(release.tag_name)
      if (semver === undefined)
        return invalid('release tag is not semver', { tag: release.tag_name })
      const version = release.tag_name.replace(/^v/u, '')

      const assetNamed = (name: string): ReleaseAsset | undefined => {
        const asset = release.assets.find((candidate) => candidate.name === name)
        return asset === undefined
          ? undefined
          : { name, url: asset.browser_download_url, sizeBytes: asset.size }
      }
      const archive = assetNamed(releaseArchiveName(version))
      const checksums = assetNamed(RELEASE_CHECKSUMS_NAME)
      const manifestAsset = assetNamed(RELEASE_MANIFEST_NAME)
      if (archive === undefined || checksums === undefined || manifestAsset === undefined) {
        return invalid('release lacks its archive, SHA256SUMS or manifest.json', {
          version,
          assets: release.assets.map((asset) => asset.name),
        })
      }
      const foreign = [archive, checksums, manifestAsset].find(
        (asset) => !asset.url.startsWith(downloadPrefix),
      )
      if (foreign !== undefined)
        return invalid('release file is not hosted on the projo releases', { asset: foreign.name })

      const sumsBytes = await download(checksums)
      if (!sumsBytes.ok) return sumsBytes
      const sums = parseChecksums(new TextDecoder().decode(sumsBytes.value))
      const manifestBytes = await download(manifestAsset)
      if (!manifestBytes.ok) return manifestBytes
      if (sums.get(RELEASE_MANIFEST_NAME) !== sha256Hex(manifestBytes.value))
        return invalid('manifest.json does not match SHA256SUMS', { version })
      if (!sums.has(archive.name))
        return invalid('SHA256SUMS does not list the archive', { version })

      const manifest = parseReleaseManifest(parseJsonBytes(manifestBytes.value))
      if (!manifest.ok)
        return invalid('invalid manifest.json', { version, reason: manifest.reason })
      if (manifest.manifest.version !== version)
        return invalid('manifest version differs from the tag', {
          version,
          manifestVersion: manifest.manifest.version,
        })

      log.debug('latest release', { version })
      return ok({
        version,
        tag: release.tag_name,
        publishedAt: new Date(release.published_at ?? release.created_at),
        notes: release.body ?? '',
        url: release.html_url,
        archive,
        checksums,
        runtimeMin: manifest.manifest.runtimeMin,
      } satisfies Release)
    },
  }
}
