import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { supervisorError, type SupervisorError } from './errors'
import { isLogLevel, type LogLevel } from './logger'
import { err, ok, type Result } from './result'
import { isSemVer } from './semver'

export type SupervisorConfig = {
  dataDir: string
  port: number
  logLevel: LogLevel
  seedDir: string
  runtimeVersion: string
  bunPath: string
  shutdownGraceMs: number
}

type Env = Readonly<Record<string, string | undefined>>

const RUNTIME_ROOT = join(import.meta.dir, '..')

export const readRuntimeVersion = (
  path: string = join(RUNTIME_ROOT, 'VERSION'),
): string | undefined => {
  try {
    const version = readFileSync(path, 'utf8').trim()
    return isSemVer(version) ? version : undefined
  } catch {
    return undefined
  }
}

export const loadConfig = (
  env: Env,
  {
    runtimeVersion = readRuntimeVersion(),
    bunPath = process.execPath,
  }: { runtimeVersion?: string | undefined; bunPath?: string } = {},
): Result<SupervisorConfig, SupervisorError<'config/invalid'>> => {
  const invalid = (message: string, context: Record<string, unknown>) =>
    err(supervisorError('config/invalid', message, context))
  const port = Number(env.PORT ?? '8080')
  if (!Number.isInteger(port) || port < 1 || port > 65_535)
    return invalid('PORT must be an integer between 1 and 65535', { PORT: env.PORT })
  const logLevel = env.LOG_LEVEL ?? 'info'
  if (!isLogLevel(logLevel))
    return invalid('LOG_LEVEL must be debug, info, warn or error', { LOG_LEVEL: env.LOG_LEVEL })
  if (runtimeVersion === undefined)
    return invalid('Runtime VERSION file is missing or not semver', { root: RUNTIME_ROOT })
  return ok({
    dataDir: env.DATA_DIR ?? '/data',
    port,
    logLevel,
    seedDir: env.PROJO_SEED_DIR ?? join(RUNTIME_ROOT, 'app'),
    runtimeVersion,
    bunPath,
    shutdownGraceMs: 25_000,
  })
}

export const appEnv = (env: Env, config: SupervisorConfig): Record<string, string> => {
  const inherited = Object.entries(env).flatMap(([key, value]) =>
    value === undefined ? [] : [[key, value] as const],
  )
  return {
    ...Object.fromEntries(inherited),
    PORT: String(config.port),
    DATA_DIR: config.dataDir,
    LOG_LEVEL: config.logLevel,
    PROJO_RUNTIME_VERSION: config.runtimeVersion,
  }
}
