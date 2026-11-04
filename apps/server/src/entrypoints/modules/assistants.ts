import { ok } from '@projo/shared'

import { assistantTokensFactory } from '../../application/auth/assistant-tokens.ts'
import { oauthFactory } from '../../application/auth/oauth.ts'
import type { ClientMetadataFetcher } from '../../core/auth/oauth.ts'
import { verifyPkceS256 } from '../../infrastructure/auth/pkce.ts'
import { sessionTokens } from '../../infrastructure/auth/session-tokens.ts'
import { createClientMetadataFetcher } from '../../infrastructure/oauth/client-metadata-fetcher.ts'
import { createInMemoryRateLimiter } from '../../infrastructure/rate-limit/in-memory-rate-limiter.ts'
import { createSqliteAccountRepository } from '../../infrastructure/sqlite/account-repository.ts'
import { createSqliteAssistantTokenRepository } from '../../infrastructure/sqlite/assistant-token-repository.ts'
import { createSqliteCatalogRepository } from '../../infrastructure/sqlite/catalog-repository.ts'
import { createSqliteLibraryRepository } from '../../infrastructure/sqlite/library-repository.ts'
import { createSqliteMetadataItemRepository } from '../../infrastructure/sqlite/metadata-item-repository.ts'
import { createSqliteOAuthRepository } from '../../infrastructure/sqlite/oauth-repository.ts'
import { createSqliteProfileRepository } from '../../infrastructure/sqlite/profile-repository.ts'
import { createSqliteSourceRepository } from '../../infrastructure/sqlite/source-repository.ts'
import { adminAssistantsRoutes } from '../http/routes/admin-assistants.ts'
import { oauthConsentRoutes } from '../http/routes/oauth-consent.ts'
import type { ScheduledTask } from '../jobs/scheduler.ts'
import { createMcpProtocol } from '../mcp/protocol.ts'
import { type McpAuthenticate, mcpRoutes } from '../mcp/routes.ts'
import {
  assistantInstructions,
  type AssistantToolsDeps,
  buildAssistantTools,
} from '../mcp/tools.ts'
import { oauthRoutes } from '../oauth/routes.ts'
import type { Platform } from './platform.ts'

const mcpRateLimit = { limit: 120, windowMs: 60_000 }
const registrationRateLimit = { limit: 10, windowMs: 60 * 60_000 }
const tokenFailureRateLimit = { limit: 20, windowMs: 15 * 60_000 }

export const buildAssistantsModule = (
  platform: Platform,
  {
    assistantPorts,
    clientMetadata = createClientMetadataFetcher(),
  }: {
    assistantPorts: Pick<AssistantToolsDeps, 'review' | 'tmdbDetails' | 'metadataLanguage'>
    clientMetadata?: ClientMetadataFetcher
  },
) => {
  const { db, clock, ids, logger, config, version } = platform
  const moduleLogger = logger.child({ module: 'assistants' })
  const assistantTokenRepository = createSqliteAssistantTokenRepository({ db })
  const profileRepository = createSqliteProfileRepository({ db })
  const assistantTokens = assistantTokensFactory({
    assistantTokenRepository,
    accountRepository: createSqliteAccountRepository({ db }),
    profileRepository,
    tokens: sessionTokens,
    clock,
    ids,
    logger: moduleLogger,
  })

  const oauth = oauthFactory({
    oauthRepository: createSqliteOAuthRepository({ db }),
    assistantTokenRepository,
    assistantTokens,
    profileRepository,
    clientMetadata,
    pkce: verifyPkceS256,
    tokens: sessionTokens,
    clock,
    ids,
    logger: moduleLogger,
  })

  const authenticate: McpAuthenticate = (token) => {
    const asToken = assistantTokens.authenticate(token)
    const principal =
      !asToken.ok && asToken.error.code === 'auth/unauthenticated'
        ? oauth.authenticateAccess(token)
        : asToken
    if (!principal.ok) return principal
    const { tokenId, accountId, profileId } = principal.value
    return ok({ credentialId: tokenId, accountId, profileId })
  }

  const protocol = createMcpProtocol({
    tools: buildAssistantTools({
      ...assistantPorts,
      sources: createSqliteSourceRepository({ db, ids }),
      libraries: createSqliteLibraryRepository({ db }),
      catalog: createSqliteCatalogRepository({ db }),
      items: createSqliteMetadataItemRepository({ db }),
    }),
    server: { name: 'projo', version, instructions: assistantInstructions },
    onToolCall: ({ tool, targets, durationMs, errorCode }) =>
      moduleLogger.info('mcp tool call', {
        tool,
        ...targets,
        durationMs,
        ...(errorCode === undefined ? {} : { code: errorCode }),
      }),
  })

  const scheduledTasks: ScheduledTask[] = [
    {
      name: 'oauth-purge',
      initialDelayMs: 30 * 60_000,
      intervalMs: 24 * 60 * 60_000,
      run: () => {
        oauth.purge()
      },
    },
  ]

  return {
    assistantTokens,
    oauth,
    adminRoutes: adminAssistantsRoutes({ assistantTokens }),
    oauthConsentRoutes: oauthConsentRoutes({ oauth, trustProxy: config.trustProxy }),
    oauthRoutes: oauthRoutes({
      oauth,
      registrationLimiter: createInMemoryRateLimiter({ ...registrationRateLimit, clock }),
      tokenFailureLimiter: createInMemoryRateLimiter({ ...tokenFailureRateLimit, clock }),
      trustProxy: config.trustProxy,
    }),
    scheduledTasks,
    mcpRoutes: mcpRoutes({
      protocol,
      authenticate,
      rateLimiter: createInMemoryRateLimiter({ ...mcpRateLimit, clock }),
      trustProxy: config.trustProxy,
    }),
  }
}

export type AssistantsModule = ReturnType<typeof buildAssistantsModule>
