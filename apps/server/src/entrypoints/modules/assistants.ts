import { ok } from '@projo/shared'

import { findCatalogItemsFactory } from '../../application/assistants/find-catalog-items.ts'
import { getItemFilesFactory } from '../../application/assistants/get-item-files.ts'
import { getReviewSourceFactory } from '../../application/assistants/get-review-source.ts'
import { getReviewSummaryFactory } from '../../application/assistants/get-review-summary.ts'
import { getTmdbSeriesFactory } from '../../application/assistants/get-tmdb-series.ts'
import { listHiddenSourcesFactory } from '../../application/assistants/list-hidden-sources.ts'
import { listReviewQueueFactory } from '../../application/assistants/list-review-queue.ts'
import { assistantTokensFactory } from '../../application/auth/assistant-tokens.ts'
import { oauthFactory } from '../../application/auth/oauth.ts'
import type { TmdbDetails } from '../../application/metadata/tmdb-details.ts'
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
import { defineModule } from './types.ts'

export type AssistantPorts = Pick<AssistantToolsDeps, 'review'> & {
  tmdbDetails: Pick<TmdbDetails, 'series' | 'season'>
  metadataLanguage: () => string
}

const mcpRateLimit = { limit: 120, windowMs: 60_000 }
const registrationRateLimit = { limit: 10, windowMs: 60 * 60_000 }
const tokenFailureRateLimit = { limit: 20, windowMs: 15 * 60_000 }

export const buildAssistantsModule = (
  platform: Platform,
  {
    assistantPorts,
    clientMetadata = createClientMetadataFetcher(),
  }: {
    assistantPorts: AssistantPorts
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

  const { review, tmdbDetails, metadataLanguage } = assistantPorts
  const sources = createSqliteSourceRepository({ db, ids })
  const libraries = createSqliteLibraryRepository({ db })
  const catalog = createSqliteCatalogRepository({ db })
  const items = createSqliteMetadataItemRepository({ db })
  const protocol = createMcpProtocol({
    tools: buildAssistantTools({
      getReviewSummary: getReviewSummaryFactory({ sources, libraries }),
      listReviewQueue: listReviewQueueFactory({ sources, libraries }),
      getReviewSource: getReviewSourceFactory({ sources, libraries, items, catalog }),
      getTmdbSeries: getTmdbSeriesFactory({ tmdbDetails, metadataLanguage }),
      findCatalogItems: findCatalogItemsFactory({ catalog, items }),
      getItemFiles: getItemFilesFactory({ sources, libraries, items, catalog }),
      listHiddenSources: listHiddenSourcesFactory({ sources, libraries }),
      review,
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

  return defineModule({
    exposes: {
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
      mcpRoutes: mcpRoutes({
        protocol,
        authenticate,
        rateLimiter: createInMemoryRateLimiter({ ...mcpRateLimit, clock }),
        trustProxy: config.trustProxy,
      }),
    },
    scheduledTasks,
  })
}

export type AssistantsModule = ReturnType<typeof buildAssistantsModule>
