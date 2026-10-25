import type { AppError, Result } from '@projo/shared'

import type { Logger } from '../../core/logger.ts'
import type {
  SegmentContributor,
  SegmentProvider,
  SegmentProviderError,
  SegmentProviderId,
} from '../../core/segments/segment.ts'
import { createProviderHttp, DEFAULT_PROVIDER_TIMEOUT_MS } from './http.ts'
import {
  createProviderLimiter,
  defaultRateLimits,
  type ProviderLimiter,
  type RateLimit,
  realSleep,
  type Sleep,
} from './rate-limit.ts'
import { createIntrodbProvider, INTRODB_BASE_URL } from './introdb.ts'
import { createSkipdbContributor, createSkipdbProvider, SKIPDB_BASE_URL } from './skipdb.ts'
import {
  createTheintrodbContributor,
  createTheintrodbProvider,
  THEINTRODB_BASE_URL,
  validateTheintrodbKeyFactory,
} from './theintrodb.ts'

export type SegmentProvidersDeps = {
  /** Injected in tests (local server replaying recorded responses). */
  fetch?: typeof fetch
  baseUrls?: Partial<Record<SegmentProviderId, string>>
  /** Per request; 10 s by default (§12.2: past it, the provider is unavailable). */
  timeoutMs?: number
  /** Tests: a manual clock and an instant sleep for the throttle (rate-limit.ts). */
  now?: () => number
  sleep?: Sleep
  /** Overrides of `defaultRateLimits` (tests). */
  rateLimits?: Partial<Record<keyof typeof defaultRateLimits, RateLimit>>
  /** Read on every call: a key set in the admin applies at once. */
  theintrodbApiKey: () => string | undefined
  skipdbAnonymousKey: () => string | undefined
  /** SkipDB anonymous key, created on the first submission (§12.5). */
  saveSkipdbAnonymousKey: (key: string) => void
  logger: Logger
}

export type SegmentProviders = {
  providers: Record<SegmentProviderId, SegmentProvider>
  contributors: Record<SegmentContributor['id'], SegmentContributor>
  /** `PATCH /admin/settings`: a TheIntroDB key is checked before it is stored. */
  validateTheintrodbKey: (
    key: string,
  ) => Promise<Result<void, AppError<'segment/theintrodb_key_invalid'> | SegmentProviderError>>
}

/** Production endpoints of the three community databases. */
export const segmentProviderBaseUrls: Record<SegmentProviderId, string> = {
  theintrodb: THEINTRODB_BASE_URL,
  introdb: INTRODB_BASE_URL,
  skipdb: SKIPDB_BASE_URL,
}

/**
 * §12.2 community providers and §12.5 contribution, behind the `SegmentProvider` port. Nothing
 * here stores or re-exposes provider data: the chain caches the results (§12.2 ToS).
 */
export const createSegmentProviders = (deps: SegmentProvidersDeps): SegmentProviders => {
  const baseUrl = (id: SegmentProviderId) =>
    (deps.baseUrls?.[id] ?? segmentProviderBaseUrls[id]).replace(/\/+$/u, '')
  const now = deps.now ?? Date.now
  const sleep = deps.sleep ?? realSleep
  /** Created once: every call of a provider in the process shares its window and its pause. */
  const limiter = (provider: SegmentProviderId, name: keyof typeof defaultRateLimits) =>
    createProviderLimiter({
      provider,
      limit: deps.rateLimits?.[name] ?? defaultRateLimits[name],
      now,
      sleep,
    })
  const http = (
    provider: SegmentProviderId,
    limiters: { default: ProviderLimiter } & Record<string, ProviderLimiter>,
  ) =>
    createProviderHttp({
      provider,
      ...(deps.fetch === undefined ? {} : { fetch: deps.fetch }),
      timeoutMs: deps.timeoutMs ?? DEFAULT_PROVIDER_TIMEOUT_MS,
      limiter: limiters.default,
      limiters,
      now,
    })
  const logger = (provider: SegmentProviderId) =>
    deps.logger.child({ module: 'segments', provider })

  const theintrodb = {
    http: http('theintrodb', {
      default: limiter('theintrodb', 'theintrodb'),
      contribute: limiter('theintrodb', 'theintrodbContribute'),
    }),
    baseUrl: baseUrl('theintrodb'),
    apiKey: deps.theintrodbApiKey,
    logger: logger('theintrodb'),
  }
  const introdb = {
    http: http('introdb', { default: limiter('introdb', 'introdb') }),
    baseUrl: baseUrl('introdb'),
    logger: logger('introdb'),
  }
  const skipdb = {
    http: http('skipdb', {
      default: limiter('skipdb', 'skipdb'),
      write: limiter('skipdb', 'skipdbWrite'),
      keys: limiter('skipdb', 'skipdbKeys'),
    }),
    baseUrl: baseUrl('skipdb'),
    logger: logger('skipdb'),
  }

  return {
    providers: {
      theintrodb: createTheintrodbProvider(theintrodb),
      introdb: createIntrodbProvider(introdb),
      skipdb: createSkipdbProvider(skipdb),
    },
    contributors: {
      theintrodb: createTheintrodbContributor(theintrodb),
      skipdb: createSkipdbContributor({
        ...skipdb,
        anonymousKey: deps.skipdbAnonymousKey,
        saveAnonymousKey: deps.saveSkipdbAnonymousKey,
      }),
    },
    validateTheintrodbKey: validateTheintrodbKeyFactory(theintrodb),
  }
}
