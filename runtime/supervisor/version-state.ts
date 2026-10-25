import { lstat, readdir, readFile, readlink, rename, symlink, unlink } from 'node:fs/promises'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { supervisorError, type SupervisorError } from './errors'
import { ENTRY_FILE, readManifest, type Manifest } from './manifest'
import { err, ok, type Result } from './result'
import { compareSemVer, isSemVer, parseSemVer } from './semver'

/** Layout of `/data/app` (PRODUCT.md §5.4). */
export type AppLayout = {
  appDir: string
  versionsDir: string
  stagingDir: string
  currentLink: string
  /** Written by the M5 switch: last known good version. */
  previousLink: string
  /** Written by the app before exit 75 (M5): the version to switch to. */
  pendingFile: string
}

export type LinkName = 'current' | 'previous'

export const appLayout = (dataDir: string): AppLayout => {
  const appDir = join(resolve(dataDir), 'app')
  return {
    appDir,
    versionsDir: join(appDir, 'versions'),
    stagingDir: join(appDir, 'staging'),
    currentLink: join(appDir, 'current'),
    previousLink: join(appDir, 'previous'),
    pendingFile: join(appDir, 'pending'),
  }
}

export const versionDir = (layout: AppLayout, version: string): string =>
  join(layout.versionsDir, version)

export type InstalledVersion = {
  version: string
  /** Real directory (never the `current` link), so the running app is unaffected by a later switch. */
  dir: string
  entry: string
  manifest: Manifest
}

export type LinkState =
  | { kind: 'missing' }
  | { kind: 'invalid'; error: SupervisorError }
  | { kind: 'ok'; installed: InstalledVersion }

export type AppState = {
  current: LinkState
  previous: LinkState
  /** Version directories present in `versions/`, newest first. */
  installed: readonly string[]
  /** Content of `pending` when present (M5). */
  pending: string | undefined
}

const isNotFound = (cause: unknown): boolean =>
  typeof cause === 'object' && !!cause && 'code' in cause && cause.code === 'ENOENT'

export const readInstalledVersion = async (
  layout: AppLayout,
  version: string,
): Promise<Result<InstalledVersion, SupervisorError>> => {
  const dir = versionDir(layout, version)
  const manifest = await readManifest(dir)
  if (!manifest.ok) return manifest
  if (manifest.value.version !== version) {
    return err(
      supervisorError('app/version_mismatch', 'Manifest version differs from its directory', {
        dir,
        manifestVersion: manifest.value.version,
      }),
    )
  }
  const entry = join(dir, ENTRY_FILE)
  if (!(await Bun.file(entry).exists())) {
    return err(supervisorError('app/entry_missing', 'App entry file is missing', { entry }))
  }
  return ok({ version, dir, entry, manifest: manifest.value })
}

const linkPath = (layout: AppLayout, name: LinkName): string =>
  name === 'current' ? layout.currentLink : layout.previousLink

export const readLink = async (layout: AppLayout, name: LinkName): Promise<LinkState> => {
  const path = linkPath(layout, name)
  const invalid = (
    message: string,
    context: Record<string, unknown>,
    cause?: unknown,
  ): LinkState => ({
    kind: 'invalid',
    error: supervisorError('app/link_invalid', message, { link: name, ...context }, cause),
  })
  try {
    const stats = await lstat(path)
    if (!stats.isSymbolicLink()) return invalid('App link is not a symlink', { path })
    const target = resolve(dirname(path), await readlink(path))
    const version = basename(target)
    if (dirname(target) !== layout.versionsDir || !isSemVer(version)) {
      return invalid('App link does not point to versions/<semver>', { path, target })
    }
    const installed = await readInstalledVersion(layout, version)
    return installed.ok
      ? { kind: 'ok', installed: installed.value }
      : { kind: 'invalid', error: installed.error }
  } catch (cause) {
    return isNotFound(cause)
      ? { kind: 'missing' }
      : invalid('Cannot read app link', { path }, cause)
  }
}

const listInstalled = async (layout: AppLayout): Promise<string[]> => {
  try {
    const entries = await readdir(layout.versionsDir, { withFileTypes: true })
    return entries
      .filter((entry) => entry.isDirectory())
      .flatMap((entry) => {
        const parsed = parseSemVer(entry.name)
        return parsed === undefined ? [] : [{ name: entry.name, parsed }]
      })
      .sort((a, b) => compareSemVer(b.parsed, a.parsed))
      .map((entry) => entry.name)
  } catch {
    return []
  }
}

const readPending = async (layout: AppLayout): Promise<string | undefined> => {
  try {
    const content = (await readFile(layout.pendingFile, 'utf8')).trim()
    return content === '' ? undefined : content
  } catch {
    return undefined
  }
}

export const readAppState = async (layout: AppLayout): Promise<AppState> => {
  const [current, previous, installed, pending] = await Promise.all([
    readLink(layout, 'current'),
    readLink(layout, 'previous'),
    listInstalled(layout),
    readPending(layout),
  ])
  return { current, previous, installed, pending }
}

/** Atomically points `current` or `previous` to `versions/<version>` (relative target). */
export const pointLink = async (
  layout: AppLayout,
  name: LinkName,
  version: string,
): Promise<Result<void, SupervisorError<'app/link_failed'>>> => {
  const path = linkPath(layout, name)
  const tmp = join(layout.appDir, `.${name}.tmp-${process.pid}-${Date.now()}`)
  const target = relative(layout.appDir, versionDir(layout, version))
  try {
    await symlink(target, tmp)
    await rename(tmp, path).catch(async (cause: unknown) => {
      // Windows (development only) refuses to rename over a directory link: not atomic there.
      if (process.platform !== 'win32') throw cause
      await unlink(path).catch(() => undefined)
      await rename(tmp, path)
    })
    return ok(undefined)
  } catch (cause) {
    await unlink(tmp).catch(() => undefined)
    return err(
      supervisorError('app/link_failed', 'Cannot update app link', { link: name, version }, cause),
    )
  }
}
