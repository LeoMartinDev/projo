import { appError, err, ok, type Result } from '@projo/shared'

import type { TvUpstream } from '../../../core/tv/channel.ts'
import type { TvGuideRead, TvGuideSink } from '../../../core/tv/guide.ts'
import type { TvChannelListing, TvProviderError } from '../../../core/tv/provider.ts'
import type { XtreamSettings } from '../../../core/tv/source.ts'
import { readXmltv, type XmltvReaderOptions } from '../xmltv/xmltv-reader.ts'
import {
  arraySchema,
  type Fetch,
  getXtreamJson,
  XTREAM_MAX_BYTES,
  XTREAM_TIMEOUT_MS,
  type XtreamAnswer,
  type XtreamCallOptions,
  type XtreamFailure,
  xtreamAccountOf,
  xtreamFail,
} from './xtream-api.ts'
import {
  accountLimitOf,
  accountRefusalOf,
  outputFormatOf,
  xtreamApiUrl,
  xtreamCategoriesOf,
  xtreamChannelsOf,
  xtreamContextOf,
  xtreamGuideUrl,
  xtreamOriginOf,
  xtreamStreamsOf,
  xtreamStreamUrlOf,
} from './xtream-channels.ts'

export type XtreamProvider = {
  listChannels: (input: {
    settings: XtreamSettings
    signal?: AbortSignal
  }) => Promise<Result<TvChannelListing, TvProviderError>>
  readGuide: (input: {
    settings: XtreamSettings
    sink: TvGuideSink
    signal?: AbortSignal
  }) => Promise<TvGuideRead>
  upstreamOf: (input: { settings: XtreamSettings; upstream: TvUpstream }) => TvUpstream | undefined
}

const hostOf = (url: string): string => (URL.canParse(url) ? new URL(url).host : '')

/** Never a URL nor the runtime's message: every URL of the source holds its credentials. */
const sourceError = (host: string, failure: XtreamFailure) => {
  const context = xtreamContextOf(host, failure)
  switch (failure.kind) {
    case 'unreachable':
      return appError('tv/source_unreachable', 'the Xtream panel could not be reached', {
        context,
      })
    case 'refused':
      return appError('tv/account_refused', 'the Xtream panel refuses the account', { context })
    case 'invalid':
      return appError('tv/source_invalid', 'the answer is not a usable Xtream listing', {
        context,
      })
  }
}

/**
 * The `xtream` connector (§29.2, §29.3): read-only `GET`s of the panel's `player_api.php` (the
 * account, its live categories and streams) and its `xmltv.php`. `now` dates the account's
 * expiry.
 */
export const createXtreamProvider = ({
  fetch: doFetch = (input, init) => fetch(input, init),
  timeoutMs = XTREAM_TIMEOUT_MS,
  maxBytes = XTREAM_MAX_BYTES,
  guide = {},
  now = () => new Date(),
}: {
  fetch?: Fetch
  timeoutMs?: number
  maxBytes?: number
  /** The XMLTV reader's options (test seams: limits and timeout). */
  guide?: XmltvReaderOptions
  now?: () => Date
} = {}): XtreamProvider => {
  const options: XtreamCallOptions = { fetch: doFetch, timeoutMs, maxBytes }

  /** A list action's answer: an array, else `not_xtream`. */
  const list = async (
    url: string,
    signal: AbortSignal | undefined,
  ): Promise<XtreamAnswer<unknown[]>> => {
    const answer = await getXtreamJson(url, options, signal)
    if (!answer.ok) return answer
    const parsed = arraySchema.safeParse(answer.value)
    return parsed.success
      ? { ok: true, value: parsed.data }
      : xtreamFail({ kind: 'invalid', reason: 'not_xtream' })
  }

  return {
    listChannels: async ({ settings, signal }) => {
      const host = hostOf(settings.serverUrl)
      const origin = xtreamOriginOf(settings.serverUrl)
      if (origin === undefined)
        return err(sourceError(host, { kind: 'invalid', reason: 'not_xtream' }))
      const answer = await getXtreamJson(xtreamApiUrl(origin, settings), options, signal)
      if (!answer.ok) return err(sourceError(host, answer.failure))
      const account = xtreamAccountOf(answer.value)
      if (account === undefined)
        return err(sourceError(host, { kind: 'invalid', reason: 'not_xtream' }))
      const refusal = accountRefusalOf(account, now())
      if (refusal !== undefined) return err(sourceError(host, { kind: 'refused', reason: refusal }))
      const format = outputFormatOf(account)
      if (format === undefined)
        return err(sourceError(host, { kind: 'invalid', reason: 'no_output_format' }))
      const categories = await list(xtreamApiUrl(origin, settings, 'get_live_categories'), signal)
      if (!categories.ok) return err(sourceError(host, categories.failure))
      const streams = await list(xtreamApiUrl(origin, settings, 'get_live_streams'), signal)
      if (!streams.ok) return err(sourceError(host, streams.failure))
      const channels = xtreamChannelsOf({
        categories: xtreamCategoriesOf(categories.value),
        streams: xtreamStreamsOf(streams.value),
        format,
      })
      if (channels.length === 0)
        return err(sourceError(host, { kind: 'invalid', reason: 'no_live_channel' }))
      return ok({ channels, account: accountLimitOf(account) })
    },
    // The account's `xmltv.php`, read like any XMLTV URL (§29.3).
    readGuide: async ({ settings, sink, signal }) => {
      const origin = xtreamOriginOf(settings.serverUrl)
      if (origin === undefined)
        return err(
          appError('tv/guide_invalid', 'the answer is not a usable guide', {
            context: { host: hostOf(settings.serverUrl), reason: 'not_xtream' },
          }),
        )
      return readXmltv(
        {
          url: xtreamGuideUrl(origin, settings),
          sink,
          ...(signal === undefined ? {} : { signal }),
        },
        { fetch: doFetch, ...guide },
      )
    },
    // Stored without credentials, built from the current settings (§29.2); anything else is
    // not an Xtream stream and is never opened.
    upstreamOf: ({ settings, upstream }) => xtreamStreamUrlOf(settings, upstream),
  }
}
