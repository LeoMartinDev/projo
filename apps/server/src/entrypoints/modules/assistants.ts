import { ok } from '@projo/shared'

import { findCatalogItemsFactory } from '../../application/assistants/find-catalog-items.ts'
import { getItemFilesFactory } from '../../application/assistants/get-item-files.ts'
import { getReviewSourceFactory } from '../../application/assistants/get-review-source.ts'
import { getReviewSummaryFactory } from '../../application/assistants/get-review-summary.ts'
import { getTmdbSeriesFactory } from '../../application/assistants/get-tmdb-series.ts'
import { listHiddenSourcesFactory } from '../../application/assistants/list-hidden-sources.ts'
import { listReviewQueueFactory } from '../../application/assistants/list-review-queue.ts'
import { authenticateAssistantTokenFactory } from '../../application/auth/authenticate-assistant-token.ts'
import { authenticateOAuthAccessFactory } from '../../application/auth/authenticate-oauth-access.ts'
import { createAssistantTokenFactory } from '../../application/auth/create-assistant-token.ts'
import { decideOAuthConsentFactory } from '../../application/auth/decide-oauth-consent.ts'
import { exchangeOAuthTokenFactory } from '../../application/auth/exchange-oauth-token.ts'
import { getOAuthConsentFactory } from '../../application/auth/get-oauth-consent.ts'
import { listAssistantTokensFactory } from '../../application/auth/list-assistant-tokens.ts'
import { purgeExpiredOAuthFactory } from '../../application/auth/purge-expired-oauth.ts'
import { registerOAuthClientFactory } from '../../application/auth/register-oauth-client.ts'
import { revokeAssistantTokenFactory } from '../../application/auth/revoke-assistant-token.ts'
import { assistantAccessFactory } from '../../application/auth/shared/assistant-access.ts'
import type { TmdbDetails } from '../../application/metadata/shared/tmdb-details.ts'
import type { ClientMetadataFetcher } from '../../core/auth/oauth.ts'
import { verifyPkceS256 } from '../../infrastructure/auth/pkce.ts'
import { sessionTokens } from '../../infrastructure/auth/session-tokens.ts'
import { createClientMetadataFetcher } from '../../infrastructure/oauth/client-metadata-fetcher.ts'
import { createInMemoryRateLimiter } from '../../infrastructure/rate-limit/in-memory-rate-limiter.ts'
import { createSqliteAccountRepository } from '../../infrastructure/sqlite/account-repository.ts'
import { createSqliteAssistantTokenRepository } from '../../infrastructure/sqlite/assistant-token-repository.ts'
import { createSqliteCatalog } from '../../infrastructure/sqlite/catalog.ts'
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

export type AssistantPorts = Pick<
  AssistantToolsDeps,
  'searchTmdb' | 'assignSource' | 'rematchItem' | 'rejectSource' | 'restoreSource'
> & {
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
  const assistantAccess = assistantAccessFactory({
    assistantTokenRepository,
    accountRepository: createSqliteAccountRepository({ db }),
    profileRepository,
    clock,
  })
  const createAssistantToken = createAssistantTokenFactory({
    assistantTokenRepository,
    tokens: sessionTokens,
    clock,
    ids,
    logger: moduleLogger,
  })
  const listAssistantTokens = listAssistantTokensFactory({ assistantTokenRepository })
  const revokeAssistantToken = revokeAssistantTokenFactory({
    assistantTokenRepository,
    clock,
    logger: moduleLogger,
  })
  const authenticateAssistantToken = authenticateAssistantTokenFactory({
    assistantTokenRepository,
    assistantAccess,
    tokens: sessionTokens,
  })

  const oauthRepository = createSqliteOAuthRepository({ db })
  const oauthRequestDeps = { oauthRepository, clientMetadata, clock, ids }
  const getOAuthConsent = getOAuthConsentFactory({
    ...oauthRequestDeps,
    assistantAccess,
    profileRepository,
  })
  const decideOAuthConsent = decideOAuthConsentFactory({
    ...oauthRequestDeps,
    assistantAccess,
    tokens: sessionTokens,
    logger: moduleLogger,
  })
  const authenticateOAuthAccess = authenticateOAuthAccessFactory({
    oauthRepository,
    assistantTokenRepository,
    assistantAccess,
    tokens: sessionTokens,
    clock,
  })
  const purgeExpiredOAuth = purgeExpiredOAuthFactory({ oauthRepository, clock })

  const authenticate: McpAuthenticate = (token) => {
    const asToken = authenticateAssistantToken(token)
    const principal =
      !asToken.ok && asToken.error.code === 'auth/unauthenticated'
        ? authenticateOAuthAccess(token)
        : asToken
    if (!principal.ok) return principal
    const { tokenId, accountId, profileId } = principal.value
    return ok({ credentialId: tokenId, accountId, profileId })
  }

  const {
    searchTmdb,
    assignSource,
    rematchItem,
    rejectSource,
    restoreSource,
    tmdbDetails,
    metadataLanguage,
  } = assistantPorts
  const sources = createSqliteSourceRepository({ db, ids })
  const libraries = createSqliteLibraryRepository({ db })
  const catalog = createSqliteCatalog({ db })
  const items = createSqliteMetadataItemRepository({ db })
  const protocol = createMcpProtocol({
    tools: buildAssistantTools({
      getReviewSummary: getReviewSummaryFactory({ sources, libraries }),
      listReviewQueue: listReviewQueueFactory({ sources, libraries }),
      getReviewSource: getReviewSourceFactory({ sources, libraries, items, visibleItems: catalog }),
      getTmdbSeries: getTmdbSeriesFactory({ tmdbDetails, metadataLanguage }),
      findCatalogItems: findCatalogItemsFactory({ catalogReadModel: catalog, items }),
      getItemFiles: getItemFilesFactory({ sources, libraries, items, visibleItems: catalog }),
      listHiddenSources: listHiddenSourcesFactory({ sources, libraries }),
      searchTmdb,
      assignSource,
      rematchItem,
      rejectSource,
      restoreSource,
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
        purgeExpiredOAuth()
      },
    },
  ]

  return defineModule({
    exposes: {
      createAssistantToken,
      listAssistantTokens,
      revokeAssistantToken,
      getOAuthConsent,
      decideOAuthConsent,
      adminRoutes: adminAssistantsRoutes({
        listAssistantTokens,
        createAssistantToken,
        revokeAssistantToken,
      }),
      oauthConsentRoutes: oauthConsentRoutes({
        getOAuthConsent,
        decideOAuthConsent,
        trustProxy: config.trustProxy,
      }),
      oauthRoutes: oauthRoutes({
        registerOAuthClient: registerOAuthClientFactory({
          oauthRepository,
          tokens: sessionTokens,
          clock,
          ids,
          logger: moduleLogger,
        }),
        exchangeOAuthToken: exchangeOAuthTokenFactory({
          oauthRepository,
          assistantTokenRepository,
          assistantAccess,
          pkce: verifyPkceS256,
          tokens: sessionTokens,
          clock,
          ids,
          logger: moduleLogger,
        }),
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
