import { existsSync, readFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'

export const TEST_TMDB_KEY = 'projo-test-tmdb-key-0123456789'

export const fixturesDir = resolve(import.meta.dirname, '../fixtures/tmdb')

const PNG = Uint8Array.from(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64',
  ),
)
const JPEG = Uint8Array.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0xff, 0xd9,
])

export const slugOf = (query: string): string =>
  query
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-|-$/gu, '')

type Logged = { path: string; params: Record<string, string> }

export const startTmdbServer = () => {
  const requests: Logged[] = []
  let rateLimitNext = 0
  const readJson = (relative: string): unknown | undefined => {
    const file = join(fixturesDir, relative)
    return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : undefined
  }
  const detail = (base: string, language: string | undefined) =>
    (language === 'en-US' ? readJson(`${base}.en-US.json`) : undefined) ?? readJson(`${base}.json`)

  const server = Bun.serve({
    port: 0,
    fetch: (request) => {
      const url = new URL(request.url)
      if (url.pathname.startsWith('/t/p/')) {
        requests.push({ path: url.pathname, params: {} })
        const png = url.pathname.endsWith('.png')
        if (url.pathname.includes('missing')) return new Response('not found', { status: 404 })
        const recorded = join(fixturesDir, 'images', basename(url.pathname))
        return new Response(existsSync(recorded) ? readFileSync(recorded) : png ? PNG : JPEG, {
          headers: { 'content-type': png ? 'image/png' : 'image/jpeg' },
        })
      }
      const path = url.pathname.replace(/^\/3\//u, '')
      const params = Object.fromEntries(url.searchParams.entries())
      requests.push({ path, params })
      const key =
        params['api_key'] ?? request.headers.get('authorization')?.replace(/^Bearer /u, '')
      if (key !== TEST_TMDB_KEY) {
        return Response.json(
          {
            status_code: 7,
            status_message: 'Invalid API key: You must be granted a valid key.',
            success: false,
          },
          { status: 401 },
        )
      }
      if (rateLimitNext > 0) {
        rateLimitNext -= 1
        return Response.json(
          { status_code: 25, status_message: 'Your request count is over the allowed limit.' },
          { status: 429, headers: { 'retry-after': '1' } },
        )
      }
      const notFound = () =>
        Response.json(
          {
            status_code: 34,
            status_message: 'The resource you requested could not be found.',
            success: false,
          },
          { status: 404 },
        )
      const search = /^search\/(movie|tv)$/u.exec(path)
      if (search) {
        const kind = search[1] ?? 'movie'
        const fixture = readJson(`search/${kind}/${slugOf(params['query'] ?? '')}.json`) as
          { results: Record<string, unknown>[] } | undefined
        const year = params[kind === 'movie' ? 'year' : 'first_air_date_year']
        const dateKey = kind === 'movie' ? 'release_date' : 'first_air_date'
        const results = (fixture?.results ?? []).filter(
          (result) => year === undefined || String(result[dateKey] ?? '').startsWith(year),
        )
        return Response.json({
          page: 1,
          results,
          total_pages: 1,
          total_results: results.length,
        })
      }
      if (path === 'configuration') return Response.json(readJson('configuration.json'))
      const find = /^find\/(.+)$/u.exec(path)
      if (find) {
        return Response.json(
          readJson(`find/${find[1]}.json`) ?? {
            movie_results: [],
            person_results: [],
            tv_results: [],
            tv_episode_results: [],
            tv_season_results: [],
          },
        )
      }
      const alternatives = /^(movie|tv)\/(\d+)\/alternative_titles$/u.exec(path)
      if (alternatives) {
        const id = Number(alternatives[2])
        return Response.json(
          readJson(`${path}.json`) ??
            (alternatives[1] === 'movie' ? { id, titles: [] } : { id, results: [] }),
        )
      }
      const images = /^((movie|tv)\/\d+(\/season\/\d+)?)\/images$/u.exec(path)
      if (images) {
        const base = images[1] ?? ''
        const recorded = readJson(`${base}/images.json`)
        if (recorded !== undefined) return Response.json(recorded)
        const owner = detail(base, undefined) as { id?: number; images?: unknown } | undefined
        if (owner === undefined) return notFound()
        return Response.json({
          id: owner.id,
          posters: [],
          backdrops: [],
          logos: [],
          ...(owner.images as object),
        })
      }
      const found = /^(movie|tv)\/\d+(\/season\/\d+)?$/u.test(path)
        ? detail(path, params['language'])
        : undefined
      return found === undefined ? notFound() : Response.json(found)
    },
  })

  return {
    apiBaseUrl: `http://localhost:${server.port}/3`,
    imageBaseUrl: `http://localhost:${server.port}/t/p`,
    requests,
    callsTo: (path: string) => requests.filter((r) => r.path === path),
    rateLimit: (count: number) => {
      rateLimitNext = count
    },
    stop: () => server.stop(true),
  }
}

export type TmdbServer = ReturnType<typeof startTmdbServer>
