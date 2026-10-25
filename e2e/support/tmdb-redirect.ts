// Preloaded into each e2e server (`bun --preload <this file> server.js`, see scripts/serve.ts).
// The server only reads PORT, DATA_DIR, TRUST_PROXY and LOG_LEVEL (§5.4) and its TMDB client
// targets api.themoviedb.org / image.tmdb.org: this preload starts the recorded TMDB of the
// server tests in the same process and reroutes `fetch` to it, without touching production
// code. Any other request to a TMDB host fails: an e2e run never reaches the real TMDB. Same for
// the segment databases (§12.2): TheIntroDB, IntroDB and SkipDB go to their recorded server.
import { startSegmentProvidersServer } from '../../apps/server/test/support/segment-providers-server.ts'
import { startTmdbServer } from '../../apps/server/test/support/tmdb-server.ts'

const tmdb = startTmdbServer()
const segments = startSegmentProvidersServer()

const routes = [
  { from: 'https://api.themoviedb.org/3/', to: `${tmdb.apiBaseUrl}/` },
  { from: 'https://image.tmdb.org/t/p/', to: `${tmdb.imageBaseUrl}/` },
  { from: 'https://api.theintrodb.org/v4/', to: `${segments.baseUrls.theintrodb}/` },
  { from: 'https://api.introdb.app/', to: `${segments.baseUrls.introdb}/` },
  { from: 'https://api.skipdb.tv/', to: `${segments.baseUrls.skipdb}/` },
] as const

const isTmdbHost = (url: string): boolean => {
  const host = URL.parse(url)?.hostname ?? ''
  return ['themoviedb.org', 'tmdb.org', 'theintrodb.org', 'introdb.app', 'skipdb.tv'].some(
    (domain) => host === domain || host.endsWith(`.${domain}`),
  )
}

/** The local URL for a replayed one, the same URL otherwise; `undefined`: a URL not replayed. */
const reroute = (url: string): string | undefined => {
  const route = routes.find(({ from }) => url.startsWith(from))
  if (route !== undefined) return route.to + url.slice(route.from.length)
  return isTmdbHost(url) ? undefined : url
}

const realFetch = globalThis.fetch

const reroutedFetch = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  const target = reroute(url)
  if (target === undefined)
    return Promise.reject(new TypeError(`e2e: unexpected external request ${url}`))
  if (target === url) return realFetch(input, init)
  return realFetch(input instanceof Request ? new Request(target, input) : target, init)
}

globalThis.fetch = Object.assign(reroutedFetch, { preconnect: realFetch.preconnect })
