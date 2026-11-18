import { appError, err, ok, type Result } from '@projo/shared'

import type { TvGuideRead, TvGuideSink } from '../../../core/tv/guide.ts'
import type {
  TvChannelListing,
  TvProviderError,
  TvSourceProvider,
} from '../../../core/tv/provider.ts'
import type { FreeboxSettings } from '../../../core/tv/source.ts'
import {
  type Fetch,
  FREEBOX_GUIDE_PACE_MS,
  FREEBOX_GUIDE_TIMEOUT_MS,
  FREEBOX_MAX_BYTES,
  FREEBOX_RATE_LIMIT_WAITS_MS,
  FREEBOX_TIMEOUT_MS,
  type FreeboxAnswer,
  type FreeboxCallOptions,
  type FreeboxFailure,
  getFreeboxJson,
  resultOf,
  tvApiBaseOf,
} from './freebox-api.ts'
import { freeboxChannelsOf, isBouquetResult, isChannelsResult } from './freebox-channels.ts'
import { freeboxGuideSlots, freeboxProgrammesOf, isGuideResult } from './freebox-guide.ts'

export type FreeboxProvider = {
  listChannels: (input: {
    settings: FreeboxSettings
    signal?: AbortSignal
  }) => Promise<Result<TvChannelListing, TvProviderError>>
  readGuide: (input: {
    settings: FreeboxSettings
    sink: TvGuideSink
    signal?: AbortSignal
  }) => Promise<TvGuideRead>
  upstreamOf: TvSourceProvider['upstreamOf']
}

const hostOf = (address: string): string => (URL.canParse(address) ? new URL(address).host : '')

/** The failure's context: the box's host and a fixed reason, never a URL (§29.2). */
const contextOf = (host: string, failure: FreeboxFailure) => ({
  host,
  reason: failure.reason,
  ...(failure.status === undefined ? {} : { status: failure.status }),
  ...(failure.kind === 'invalid' && failure.errorCode !== undefined
    ? { errorCode: failure.errorCode }
    : {}),
})

const sourceError = (host: string, failure: FreeboxFailure) =>
  failure.kind === 'unreachable'
    ? appError('tv/source_unreachable', 'the Freebox could not be reached', {
        context: contextOf(host, failure),
      })
    : appError('tv/source_invalid', 'the answer is not a usable Freebox TV listing', {
        context: contextOf(host, failure),
      })

const guideError = (host: string, failure: FreeboxFailure) =>
  failure.kind === 'unreachable'
    ? appError('tv/guide_unreachable', 'the Freebox guide could not be fetched', {
        context: contextOf(host, failure),
      })
    : appError('tv/guide_invalid', 'the answer is not a usable Freebox guide', {
        context: contextOf(host, failure),
      })

const invalid = (reason: string): { ok: false; failure: FreeboxFailure } => ({
  ok: false,
  failure: { kind: 'invalid', reason },
})

/** The box refused a call for its rate (`rate_limit`, or HTTP 429). */
const rateLimited = (failure: FreeboxFailure): boolean =>
  failure.kind === 'invalid' &&
  failure.reason === 'api_error' &&
  (failure.errorCode === 'rate_limit' || failure.status === 429)

/** `ms` of waiting, over at once when `signal` aborts (the next call then fails as aborted). */
const waitFor = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    if (signal?.aborted === true) return resolve()
    const done = () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', done)
      resolve()
    }
    const timer = setTimeout(done, ms)
    signal?.addEventListener('abort', done, { once: true })
  })

/**
 * The `freebox` connector (§29.2, §29.3): read-only `GET`s of the box's TV API, discovered
 * through `/api_version`; no credentials. `now` places the guide's hours.
 */
export const createFreeboxProvider = ({
  fetch: doFetch = (input, init) => fetch(input, init),
  timeoutMs = FREEBOX_TIMEOUT_MS,
  maxBytes = FREEBOX_MAX_BYTES,
  guideTimeoutMs = FREEBOX_GUIDE_TIMEOUT_MS,
  now = () => new Date(),
  wait = waitFor,
}: {
  fetch?: Fetch
  timeoutMs?: number
  maxBytes?: number
  guideTimeoutMs?: number
  now?: () => Date
  /** Waiting between calls once the box limited the rate (a test seam). */
  wait?: (ms: number, signal?: AbortSignal) => Promise<void>
} = {}): FreeboxProvider => {
  const options: FreeboxCallOptions = { fetch: doFetch, timeoutMs, maxBytes }

  /** The origin of the address: a trailing `/` and anything after the host never count. */
  const originOf = (address: string): string => new URL(address).origin

  const tvApi = async (address: string, signal?: AbortSignal): Promise<FreeboxAnswer<string>> => {
    if (!URL.canParse(address)) return invalid('not_freebox')
    const origin = originOf(address)
    const answer = await getFreeboxJson(`${origin}/api_version`, options, signal)
    if (!answer.ok) return answer
    const base = tvApiBaseOf(answer.value)
    return base.ok ? { ok: true, value: `${origin}${base.value}` } : base
  }

  /** A TV call's `result`, its envelope checked. */
  const tvResult = async (url: string, signal?: AbortSignal): Promise<FreeboxAnswer<unknown>> => {
    const answer = await getFreeboxJson(url, options, signal)
    return answer.ok ? resultOf(answer.value) : answer
  }

  return {
    listChannels: async ({ settings, signal }) => {
      const host = hostOf(settings.address)
      const api = await tvApi(settings.address, signal)
      if (!api.ok) return err(sourceError(host, api.failure))
      const channels = await tvResult(`${api.value}channels`, signal)
      if (!channels.ok) return err(sourceError(host, channels.failure))
      if (!isChannelsResult(channels.value))
        return err(sourceError(host, { kind: 'invalid', reason: 'not_freebox' }))
      const bouquet = await tvResult(`${api.value}bouquets/freeboxtv/channels`, signal)
      if (!bouquet.ok) return err(sourceError(host, bouquet.failure))
      if (!isBouquetResult(bouquet.value))
        return err(sourceError(host, { kind: 'invalid', reason: 'not_freebox' }))
      const listed = freeboxChannelsOf({
        address: originOf(settings.address),
        channels: channels.value,
        bouquet: bouquet.value,
      })
      if (listed.length === 0)
        return err(sourceError(host, { kind: 'invalid', reason: 'no_live_channel' }))
      return ok({ channels: listed })
    },
    // The box's EPG, hour by hour from 6 hours ago to 72 hours ahead: 79 requests, one at a
    // time, within one deadline for the whole read (§29.3). Refused for its rate, the read waits
    // and asks that hour again, then goes on at a pace of one call a second.
    readGuide: async ({ settings, sink, signal }) => {
      const host = hostOf(settings.address)
      const deadline = AbortSignal.timeout(guideTimeoutMs)
      const guideSignal = signal === undefined ? deadline : AbortSignal.any([signal, deadline])
      const api = await tvApi(settings.address, guideSignal)
      if (!api.ok) return err(guideError(host, api.failure))
      const seen = new Set<string>()
      let paceMs = 0
      const hour = async (slot: number): Promise<FreeboxAnswer<unknown>> => {
        for (let refused = 0; ; refused += 1) {
          if (paceMs > 0) await wait(paceMs, guideSignal)
          const answer = await tvResult(`${api.value}epg/by_time/${slot}`, guideSignal)
          const delay = FREEBOX_RATE_LIMIT_WAITS_MS[refused]
          if (answer.ok || !rateLimited(answer.failure) || delay === undefined) return answer
          paceMs = FREEBOX_GUIDE_PACE_MS
          await wait(delay, guideSignal)
        }
      }
      for (const slot of freeboxGuideSlots(now())) {
        const answer = await hour(slot)
        if (!answer.ok) return err(guideError(host, answer.failure))
        if (!isGuideResult(answer.value))
          return err(guideError(host, { kind: 'invalid', reason: 'not_freebox' }))
        for (const programme of freeboxProgrammesOf(answer.value, seen, settings.address))
          sink.programme(programme)
      }
      return ok({ available: true })
    },
    // The box's URL as it gives it: no User-Agent nor referrer (§29.2).
    upstreamOf: ({ upstream }) => upstream,
  }
}
