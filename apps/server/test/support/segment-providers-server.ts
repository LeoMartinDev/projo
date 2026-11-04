import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import type { SegmentItemRef } from '../../src/core/segments/segment.ts'

export const TEST_THEINTRODB_KEY = 'projo-test-theintrodb-key-0123456789'

export const recordedSegmentItems = {
  simpsons: {
    itemId: 'item-simpsons-s01e01',
    kind: 'episode',
    tvdbId: 71663,
    tmdbId: 456,
    imdbId: 'tt0096697',
    seasonNumber: 1,
    episodeNumber: 1,
    durationMs: 1_394_000,
    detectSegments: true,
  },
  breakingBad: {
    itemId: 'item-breaking-bad-s01e01',
    kind: 'episode',
    tvdbId: 81189,
    tmdbId: 1396,
    imdbId: 'tt0903747',
    seasonNumber: 1,
    episodeNumber: 1,
    durationMs: 3_500_000,
    detectSegments: true,
  },
  breakingBadMissing: {
    itemId: 'item-breaking-bad-s01e99',
    kind: 'episode',
    tvdbId: 81189,
    tmdbId: 1396,
    imdbId: 'tt0903747',
    seasonNumber: 1,
    episodeNumber: 99,
    durationMs: 3_000_000,
    detectSegments: true,
  },
  fightClub: {
    itemId: 'item-fight-club',
    kind: 'movie',
    tmdbId: 550,
    imdbId: 'tt0137523',
    durationMs: 8_348_000,
    detectSegments: true,
  },
} as const satisfies Record<string, SegmentItemRef>

export const segmentFixturesDir = resolve(import.meta.dirname, '../fixtures/segments')

export type FakeSegmentProvider = 'theintrodb' | 'introdb' | 'skipdb'

export type LoggedProviderRequest = {
  provider: FakeSegmentProvider
  method: string
  path: string
  params: Record<string, string>
  authorization?: string
  apiKey?: string
  body?: unknown
}

export type ScriptedResponse = {
  status: number
  json?: unknown
  text?: string
  headers?: Record<string, string>
  delayMs?: number
}

const readFixture = (relative: string): unknown => {
  const file = join(segmentFixturesDir, relative)
  return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as unknown) : undefined
}

const episodeSuffix = (params: Record<string, string>): string =>
  params['season'] === undefined ? '' : `-s${params['season']}e${params['episode'] ?? ''}`

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== undefined && value
    ? (value as Record<string, unknown>)
    : {}

export const startSegmentProvidersServer = () => {
  const requests: LoggedProviderRequest[] = []
  const scripted: Record<FakeSegmentProvider, ScriptedResponse[]> = {
    theintrodb: [],
    introdb: [],
    skipdb: [],
  }
  let issuedKeys: string[] = []
  let keyCount = 0
  let nextId = 1

  const theintrodb = (request: LoggedProviderRequest): Response => {
    const { method, path, params } = request
    const authorized = request.authorization === `Bearer ${TEST_THEINTRODB_KEY}`
    if (method === 'GET' && path === '/v4/media') {
      if ((params['season'] === undefined) !== (params['episode'] === undefined))
        return Response.json(
          { error: 'season and episode must be provided together' },
          { status: 400 },
        )
      const id =
        params['tvdb_id'] !== undefined
          ? `tvdb-${params['tvdb_id']}`
          : params['tmdb_id'] !== undefined
            ? `tmdb-${params['tmdb_id']}`
            : params['imdb_id'] !== undefined
              ? `imdb-${params['imdb_id']}`
              : undefined
      if (id === undefined)
        return Response.json({ error: 'tmdb_id, imdb_id, or tvdb_id is required' }, { status: 400 })
      const found = readFixture(`theintrodb/media/${id}${episodeSuffix(params)}.json`)
      return found === undefined
        ? Response.json(readFixture('theintrodb/media/not-found.json'), { status: 404 })
        : Response.json(found)
    }
    if (method === 'POST' && (path === '/v4/submit' || path === '/v4/map')) {
      if (!authorized) return Response.json({ error: 'Invalid or expired token' }, { status: 401 })
      const body = asRecord(request.body)
      if (path === '/v4/map')
        return Response.json({
          tvdb_id: body['tvdb_id'] ?? 1,
          type: body['type'],
          mapping: 'default',
        })
      return Response.json({
        ok: true,
        submissions: [
          {
            id: `00000000-0000-7000-8000-${String(nextId++).padStart(12, '0')}`,
            tvdbId: body['tvdb_id'] ?? 1,
            type: body['type'],
            segment: body['segment'],
            ...(body['type'] === 'tv' ? { season: body['season'], episode: body['episode'] } : {}),
            videoDurationMs: body['video_duration_ms'] ?? undefined,
            startMs: body['start_ms'],
            endMs: body['end_ms'],
            status: 'pending',
            weight: 1,
          },
        ],
      })
    }
    return Response.json({ error: 'not found' }, { status: 404 })
  }

  const introdb = ({ method, path, params }: LoggedProviderRequest): Response => {
    if (method === 'GET' && path === '/segments') {
      const key =
        params['is_movie'] === 'true'
          ? `${params['imdb_id']}-movie`
          : `${params['imdb_id']}${episodeSuffix(params)}`
      const found = readFixture(`introdb/segments/${key}.json`)
      return found === undefined
        ? Response.json({ error: 'No segments found for this episode' }, { status: 404 })
        : Response.json(found)
    }
    return Response.json({ error: 'not found' }, { status: 404 })
  }

  const skipdb = (request: LoggedProviderRequest): Response => {
    const { method, path, params } = request
    if (method === 'GET' && path === '/api/segments') {
      const found = readFixture(`skipdb/segments/${params['imdb_id']}${episodeSuffix(params)}.json`)
      return Response.json(
        found ?? {
          ...asRecord(readFixture('skipdb/segments/tt0903747-s1e99.json')),
          imdb_id: params['imdb_id'],
          season: params['season'] === undefined ? undefined : Number(params['season']),
          episode: params['episode'] === undefined ? undefined : Number(params['episode']),
        },
      )
    }
    if (method === 'POST' && path === '/api/keys/anonymous') {
      keyCount += 1
      const key = `skdb_live_test${String(keyCount).padStart(4, '0')}`
      issuedKeys.push(key)
      return Response.json(
        { key, prefix: key.slice(0, 14), message: 'Store this key now.' },
        { status: 201 },
      )
    }
    if (method === 'POST' && path === '/api/segments') {
      const key = request.apiKey ?? request.authorization?.replace(/^Bearer /u, '')
      if (key === undefined || !issuedKeys.includes(key))
        return Response.json({ error: 'Authentication required' }, { status: 401 })
      return Response.json(
        {
          id: nextId++,
          status: 'pending',
          auto_approved: false,
          reasons: [],
          message: 'Submitted for review.',
          license: 'ODbL-1.0',
        },
        { status: 201 },
      )
    }
    return Response.json({ error: 'not found' }, { status: 404 })
  }

  const routes = { theintrodb, introdb, skipdb }

  const server = Bun.serve({
    port: 0,
    fetch: async (raw) => {
      const url = new URL(raw.url)
      const [, prefix = '', ...rest] = url.pathname.split('/')
      if (prefix !== 'theintrodb' && prefix !== 'introdb' && prefix !== 'skipdb')
        return new Response('unknown provider', { status: 404 })
      const text = raw.method === 'POST' ? await raw.text() : ''
      const authorization = raw.headers.get('authorization') ?? undefined
      const apiKey = raw.headers.get('x-api-key') ?? undefined
      const request: LoggedProviderRequest = {
        provider: prefix,
        method: raw.method,
        path: `/${rest.join('/')}`,
        params: Object.fromEntries(url.searchParams.entries()),
        ...(authorization === undefined ? {} : { authorization }),
        ...(apiKey === undefined ? {} : { apiKey }),
        ...(text === '' ? {} : { body: JSON.parse(text) as unknown }),
      }
      requests.push(request)
      const next = scripted[prefix].shift()
      if (next === undefined) return routes[prefix](request)
      if (next.delayMs !== undefined) await Bun.sleep(next.delayMs)
      const headers = { 'content-type': 'application/json', ...next.headers }
      return new Response(next.text ?? (next.json === undefined ? '' : JSON.stringify(next.json)), {
        status: next.status,
        headers,
      })
    },
  })

  const origin = `http://localhost:${server.port}`
  return {
    baseUrls: {
      theintrodb: `${origin}/theintrodb/v4`,
      introdb: `${origin}/introdb`,
      skipdb: `${origin}/skipdb`,
    },
    requests,
    callsTo: (provider: FakeSegmentProvider, path?: string) =>
      requests.filter((r) => r.provider === provider && (path === undefined || r.path === path)),
    respondNext: (provider: FakeSegmentProvider, ...responses: ScriptedResponse[]) => {
      scripted[provider].push(...responses)
    },
    revokeSkipdbKeys: () => {
      issuedKeys = []
    },
    stop: () => server.stop(true),
  }
}

export const createFakeClock = (startMs = Date.parse('2026-10-24T10:00:00.000Z')) => {
  let current = startMs
  const slept: number[] = []
  return {
    now: () => current,
    sleep: async (ms: number, signal?: AbortSignal): Promise<boolean> => {
      if (signal?.aborted === true) return false
      const until = current + ms
      slept.push(ms)
      await Promise.resolve()
      current = Math.max(current, until)
      return true
    },
    advance: (ms: number) => {
      current += ms
    },
    slept,
  }
}

export type SegmentProvidersServer = ReturnType<typeof startSegmentProvidersServer>
