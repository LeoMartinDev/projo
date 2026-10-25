import { z } from 'zod'

import { appError, type AppError, err, ok, type Result } from '@projo/shared'

import { logLevels, type LogLevel } from '../core/logger.ts'

/** The four environment variables of §5.4, and nothing else. Everything else lives in `settings`. */
export type Config = {
  port: number
  dataDir: string
  trustProxy: boolean
  logLevel: LogLevel
}

const booleanFromEnv = z
  .enum(['true', 'false', '1', '0'])
  .transform((value) => value === 'true' || value === '1')

const envSchema = z.object({
  PORT: z.coerce.number().int().min(0).max(65_535).default(8080),
  DATA_DIR: z.string().min(1).default('/data'),
  TRUST_PROXY: booleanFromEnv.default(false),
  LOG_LEVEL: z.enum(logLevels).default('info'),
})

export const loadConfig = (
  env: Record<string, string | undefined>,
): Result<Config, AppError<'config/invalid'>> => {
  const parsed = envSchema.safeParse({
    PORT: env['PORT'] || undefined,
    DATA_DIR: env['DATA_DIR'] || undefined,
    TRUST_PROXY: env['TRUST_PROXY']?.toLowerCase() || undefined,
    LOG_LEVEL: env['LOG_LEVEL']?.toLowerCase() || undefined,
  })
  if (!parsed.success) {
    return err(
      appError('config/invalid', 'invalid environment configuration', {
        context: { issues: z.flattenError(parsed.error).fieldErrors },
      }),
    )
  }
  return ok({
    port: parsed.data.PORT,
    dataDir: parsed.data.DATA_DIR,
    trustProxy: parsed.data.TRUST_PROXY,
    logLevel: parsed.data.LOG_LEVEL,
  })
}
