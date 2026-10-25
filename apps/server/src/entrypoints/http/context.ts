import type { AuthAccount, AuthSession } from '../../core/auth/principal.ts'
import type { Logger } from '../../core/logger.ts'

/**
 * Hono context variables. `account`, `session` and `profileId` are set by the authentication
 * middleware (auth module) and stay `undefined` on anonymous requests.
 */
export type AppVariables = {
  requestId: string
  /** Request-scoped logger carrying `requestId`. */
  logger: Logger
  account: AuthAccount | undefined
  session: AuthSession | undefined
  /** Active profile from `X-Profile-Id`, verified as belonging to `account` (§17.1). */
  profileId: string | undefined
}

export type AppEnv = { Variables: AppVariables }
