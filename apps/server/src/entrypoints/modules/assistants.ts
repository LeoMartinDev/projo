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

/** §27.3: 120 `/mcp` requests per minute per credential. */
const mcpRateLimit = { limit: 120, windowMs: 60_000 }
/** §27.3: 10 client registrations per hour per IP. */
const registrationRateLimit = { limit: 10, windowMs: 60 * 60_000 }
/** §27.3: 20 failed token requests per 15 min per IP. */
const tokenFailureRateLimit = { limit: 20, windowMs: 15 * 60_000 }

/**
 * Wiring of the MCP server (§27): assistant tokens ("AI assistants" in Admin → Server), OAuth 2.1
 * (discovery, registration, consent, tokens) and `POST /mcp` with the tools of §27.4, over the
 * metadata module's use cases.
 */
export const buildAssistantsModule = (
  platform: Platform,
  {
    assistantPorts,
    clientMetadata = createClientMetadataFetcher(),
  }: {
    assistantPorts: Pick<AssistantToolsDeps, 'review' | 'tmdbDetails' | 'metadataLanguage'>
    /** Tests: Client ID Metadata Documents served locally. */
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

  // A token created in the admin, else an OAuth access token.
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
      // §27.3: expired codes and tokens, registrations unused for 30 days.
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
    /** Mounted at the root, next to `/health` (§27.2). */
    mcpRoutes: mcpRoutes({
      protocol,
      authenticate,
      rateLimiter: createInMemoryRateLimiter({ ...mcpRateLimit, clock }),
      trustProxy: config.trustProxy,
    }),
  }
}

export type AssistantsModule = ReturnType<typeof buildAssistantsModule>
