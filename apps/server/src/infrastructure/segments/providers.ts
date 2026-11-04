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
  fetch?: typeof fetch
  baseUrls?: Partial<Record<SegmentProviderId, string>>
  timeoutMs?: number
  now?: () => number
  sleep?: Sleep
  rateLimits?: Partial<Record<keyof typeof defaultRateLimits, RateLimit>>
  theintrodbApiKey: () => string | undefined
  skipdbAnonymousKey: () => string | undefined
  saveSkipdbAnonymousKey: (key: string) => void
  logger: Logger
}

export type SegmentProviders = {
  providers: Record<SegmentProviderId, SegmentProvider>
  contributors: Record<SegmentContributor['id'], SegmentContributor>
  validateTheintrodbKey: (
    key: string,
  ) => Promise<Result<void, AppError<'segment/theintrodb_key_invalid'> | SegmentProviderError>>
}

export const segmentProviderBaseUrls: Record<SegmentProviderId, string> = {
  theintrodb: THEINTRODB_BASE_URL,
  introdb: INTRODB_BASE_URL,
  skipdb: SKIPDB_BASE_URL,
}

export const createSegmentProviders = (deps: SegmentProvidersDeps): SegmentProviders => {
  const baseUrl = (id: SegmentProviderId) =>
    (deps.baseUrls?.[id] ?? segmentProviderBaseUrls[id]).replace(/\/+$/u, '')
  const now = deps.now ?? Date.now
  const sleep = deps.sleep ?? realSleep
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
