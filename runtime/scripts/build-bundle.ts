// Assembles the app bundle (PRODUCT.md §16.2) into dist/app/:
//   server.js (+ map, chunks), public/, drizzle/, [locales/], [avatars/], manifest.json
// Usage: bun runtime/scripts/build-bundle.ts [--out dist/app] [--version x.y.z] [--runtime-min x.y.z]
import { cp, mkdir, readFile, rename, rm, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { readRuntimeVersion } from '../supervisor/config'
import {
  ENTRY_FILE,
  hashTree,
  MANIFEST_FILE,
  parseManifest,
  type Manifest,
} from '../supervisor/manifest'
import { err, ok, type Result } from '../supervisor/result'
import { isSemVer } from '../supervisor/semver'

export type BundleErrorCode =
  | 'bundle/source_missing'
  | 'bundle/invalid_version'
  | 'bundle/build_failed'
  | 'bundle/native_module'
  | 'bundle/write_failed'

export type BundleError = {
  code: BundleErrorCode
  message: string
  context?: Record<string, unknown>
  cause?: unknown
}

const bundleError = (
  code: BundleErrorCode,
  message: string,
  context?: Record<string, unknown>,
  cause?: unknown,
): BundleError => ({
  code,
  message,
  ...(context === undefined ? {} : { context }),
  ...(cause === undefined ? {} : { cause }),
})

/** Monorepo sources, relative to the repo root. */
export const SOURCES = {
  serverEntry: 'apps/server/src/entrypoints/main.ts',
  webDist: 'apps/web/dist',
  migrations: 'apps/server/drizzle',
} as const

/** Copied when present: bundle dir -> repo path. */
export const OPTIONAL_DIRS = {
  locales: 'apps/server/locales',
  avatars: 'apps/server/avatars',
} as const

export type BuildBundleInput = {
  rootDir: string
  outDir: string
  version: string
  runtimeMin: string
  now?: () => Date
}

const isDirectory = async (path: string): Promise<boolean> =>
  (await stat(path).catch(() => undefined))?.isDirectory() ?? false

const checkSources = async (rootDir: string): Promise<Result<void, BundleError>> => {
  const missing = []
  if (!(await Bun.file(join(rootDir, SOURCES.serverEntry)).exists()))
    missing.push(SOURCES.serverEntry)
  if (!(await isDirectory(join(rootDir, SOURCES.webDist)))) missing.push(SOURCES.webDist)
  if (!(await isDirectory(join(rootDir, SOURCES.migrations)))) missing.push(SOURCES.migrations)
  return missing.length === 0
    ? ok(undefined)
    : err(
        bundleError(
          'bundle/source_missing',
          'Build inputs are missing (build the server and web apps first)',
          { missing },
        ),
      )
}

const bundleServer = async (
  rootDir: string,
  stageDir: string,
): Promise<Result<void, BundleError>> => {
  try {
    const result = await Bun.build({
      entrypoints: [join(rootDir, SOURCES.serverEntry)],
      outdir: stageDir,
      target: 'bun',
      format: 'esm',
      sourcemap: 'linked',
      naming: {
        entry: ENTRY_FILE,
        chunk: 'chunks/[name]-[hash].[ext]',
        asset: 'assets/[name]-[hash].[ext]',
      },
      define: { 'process.env.NODE_ENV': '"production"' },
    })
    if (!result.success) {
      return err(
        bundleError('bundle/build_failed', 'bun build failed', {
          logs: result.logs.map((log) => log.message),
        }),
      )
    }
    const native = result.outputs
      .map((output) => output.path)
      .filter((path) => path.endsWith('.node'))
    if (native.length > 0) {
      return err(
        bundleError('bundle/native_module', 'The app bundle must be pure JS (PRODUCT.md §16.1)', {
          native,
        }),
      )
    }
    return ok(undefined)
  } catch (cause) {
    return err(bundleError('bundle/build_failed', 'bun build failed', {}, cause))
  }
}

export const buildBundle = async ({
  rootDir,
  outDir,
  version,
  runtimeMin,
  now = () => new Date(),
}: BuildBundleInput): Promise<Result<Manifest, BundleError>> => {
  const sources = await checkSources(rootDir)
  if (!sources.ok) return sources
  if (!isSemVer(version)) {
    return err(
      bundleError(
        'bundle/invalid_version',
        'version is not semver (pass --version, PROJO_VERSION or set "version" in the root package.json)',
        { version },
      ),
    )
  }
  if (!isSemVer(runtimeMin))
    return err(bundleError('bundle/invalid_version', 'runtimeMin is not semver', { runtimeMin }))

  const stageDir = `${outDir}.tmp-${process.pid}`
  await rm(stageDir, { recursive: true, force: true })
  const built = await bundleServer(rootDir, stageDir)
  if (!built.ok) {
    await rm(stageDir, { recursive: true, force: true })
    return built
  }

  try {
    await cp(join(rootDir, SOURCES.webDist), join(stageDir, 'public'), { recursive: true })
    await cp(join(rootDir, SOURCES.migrations), join(stageDir, 'drizzle'), { recursive: true })
    for (const [target, source] of Object.entries(OPTIONAL_DIRS)) {
      if (await isDirectory(join(rootDir, source)))
        await cp(join(rootDir, source), join(stageDir, target), { recursive: true })
    }
    const manifest = parseManifest({
      version,
      runtimeMin,
      builtAt: now().toISOString(),
      files: await hashTree(stageDir),
    })
    if (!manifest.ok) return err(bundleError('bundle/build_failed', manifest.error.message))
    await Bun.write(
      join(stageDir, MANIFEST_FILE),
      `${JSON.stringify(manifest.value, undefined, 2)}\n`,
    )
    await rm(outDir, { recursive: true, force: true })
    await mkdir(resolve(outDir, '..'), { recursive: true })
    await rename(stageDir, outDir)
    return manifest
  } catch (cause) {
    await rm(stageDir, { recursive: true, force: true })
    return err(bundleError('bundle/write_failed', 'Cannot assemble the bundle', { outDir }, cause))
  }
}

const readRootVersion = async (rootDir: string): Promise<string | undefined> => {
  try {
    const pkg: unknown = JSON.parse(await readFile(join(rootDir, 'package.json'), 'utf8'))
    return typeof pkg === 'object' && !!pkg && 'version' in pkg && typeof pkg.version === 'string'
      ? pkg.version
      : undefined
  } catch {
    return undefined
  }
}

if (import.meta.main) {
  const rootDir = resolve(import.meta.dir, '../..')
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      out: { type: 'string' },
      version: { type: 'string' },
      'runtime-min': { type: 'string' },
    },
  })
  const outDir = resolve(values.out ?? join(rootDir, 'dist/app'))
  const result = await buildBundle({
    rootDir,
    outDir,
    // `||`: an empty PROJO_VERSION (unset Docker build arg) falls back to package.json.
    version: values.version || process.env.PROJO_VERSION || (await readRootVersion(rootDir)) || '',
    runtimeMin: values['runtime-min'] || readRuntimeVersion() || '',
  })
  if (!result.ok) {
    console.error(`${result.error.code}: ${result.error.message}`)
    if (result.error.context !== undefined)
      console.error(JSON.stringify(result.error.context, undefined, 2))
    if (result.error.cause !== undefined) console.error(result.error.cause)
    process.exit(1)
  }
  console.log(
    `bundle ${result.value.version} (runtimeMin ${result.value.runtimeMin}, ${Object.keys(result.value.files).length} files) -> ${outDir}`,
  )
}
