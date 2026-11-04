import type { AuthAccount, AuthSession } from '../../core/auth/principal.ts'
import type { Logger } from '../../core/logger.ts'

export type AppVariables = {
  requestId: string
  logger: Logger
  account: AuthAccount | undefined
  session: AuthSession | undefined
  profileId: string | undefined
}

export type AppEnv = { Variables: AppVariables }
