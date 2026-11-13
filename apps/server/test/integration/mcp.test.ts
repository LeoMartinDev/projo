import { afterEach, beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test'

import { Hono } from 'hono'

import type { AppEnv } from '../../src/entrypoints/http/context.ts'
import { buildAssistantsModule } from '../../src/entrypoints/modules/assistants.ts'
import { insertItem, insertLibrary, insertSource, seedViewer } from '../support/catalog-fixtures.ts'
import { silentLogger } from '../support/logger.ts'
import { createMetadataWorld, type MetadataWorld } from '../support/metadata-world.ts'

setDefaultTimeout(90_000)

let world: MetadataWorld
let assistants: ReturnType<typeof buildAssistantsModule>
let app: Hono<AppEnv>
let token: string
let viewer: ReturnType<typeof seedViewer>

beforeEach(() => {
  world = createMetadataWorld()
  assistants = buildAssistantsModule(world.platform, {
    assistantPorts: world.metadata.assistantPorts,
  })
  viewer = seedViewer(world.db, 'admin-1')
  token = createToken()
  app = new Hono<AppEnv>()
    .use('*', async (c, next) => {
      c.set('logger', silentLogger)
      await next()
    })
    .route('/', assistants.mcpRoutes)
})
afterEach(async () => {
  await world.stop()
})

const createToken = (): string =>
  assistants.createAssistantToken({
    accountId: viewer.accountId,
    profileId: viewer.profileId,
    name: 'Claude',
  }).token

const sourceRow = (pathEnd: string) =>
  world.query<{ id: string; match_state: string; review_reason?: string; state: string }>(
    'SELECT id, match_state, review_reason, state FROM sources WHERE relative_path LIKE ?',
    `%${pathEnd}`,
  )[0]

const seedReview = () => {
  insertLibrary(world.db)
  insertItem(world.db, { id: 'local-ours', kind: 'series', title: 'Ours' })
  insertItem(world.db, {
    id: 'local-ours-s1',
    kind: 'season',
    parentId: 'local-ours',
    seasonNumber: 1,
  })
  for (const episode of [1, 2, 9]) {
    const id = `ours-e${episode}`
    insertItem(world.db, {
      id: `local-${id}`,
      kind: 'episode',
      parentId: 'local-ours-s1',
      seasonNumber: 1,
      episodeNumber: episode,
    })
    insertSource(world.db, {
      id,
      itemId: `local-${id}`,
      relativePath: `Ours/Season 1/Ours.S01E0${episode}.mkv`,
      classification: 'episode',
      parsed: { series: 'Ours', season: 1, episode },
      matchState: 'needs_review',
      reviewReason: 'no_match',
    })
  }
  insertItem(world.db, { id: 'local-dune', kind: 'movie', title: 'Dune' })
  insertSource(world.db, {
    id: 'dune',
    itemId: 'local-dune',
    relativePath: 'Dune.mkv',
    classification: 'movie',
    parsed: { title: 'Dune' },
    matchState: 'needs_review',
    reviewReason: 'ambiguous_match',
  })
}

const post = (body: unknown, headers: Record<string, string> = {}) =>
  app.request('/mcp', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      authorization: `Bearer ${token}`,
      ...headers,
    },
    body: JSON.stringify(body),
  })

let rpcId = 0
const rpc = async (method: string, params?: Record<string, unknown>) => {
  rpcId += 1
  const response = await post({ jsonrpc: '2.0', id: rpcId, method, ...(params ? { params } : {}) })
  expect(response.status).toBe(200)
  return (await response.json()) as {
    result?: Record<string, unknown> & {
      structuredContent?: Record<string, unknown>
      isError?: boolean
    }
    error?: { code: number; message: string }
  }
}
const call = async (name: string, args: Record<string, unknown> = {}) => {
  const response = await rpc('tools/call', { name, arguments: args })
  if (response.result === undefined) throw new Error(JSON.stringify(response.error))
  return response.result
}

describe('POST /mcp (§27.2, §27.3)', () => {
  test('initialize, tools/list, ping; a notification gets 202', async () => {
    const init = await rpc('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'test', version: '1' },
    })
    expect(init.result).toMatchObject({
      protocolVersion: '2025-06-18',
      capabilities: { tools: {} },
      serverInfo: { name: 'projo' },
    })
    const notified = await post({ jsonrpc: '2.0', method: 'notifications/initialized' })
    expect(notified.status).toBe(202)
    expect((await rpc('ping')).result).toEqual({})

    const listed = await rpc('tools/list')
    const tools = (listed.result?.['tools'] ?? []) as {
      name: string
      inputSchema: { type: string }
      annotations: { readOnlyHint: boolean }
    }[]
    expect(tools.map((tool) => tool.name)).toEqual([
      'review_summary',
      'list_review_queue',
      'get_review_source',
      'search_tmdb',
      'get_tmdb_series',
      'find_items',
      'get_item',
      'list_hidden_sources',
      'assign_source',
      'rematch_item',
      'hide_source',
      'restore_source',
    ])
    expect(tools.every((tool) => tool.inputSchema.type === 'object')).toBe(true)
    expect(tools.find((tool) => tool.name === 'assign_source')?.annotations.readOnlyHint).toBe(
      false,
    )
    expect((await rpc('nope')).error?.code).toBe(-32601)
  })

  test('without a token: 401 with the OAuth pointer; a foreign Origin: 403; GET: 405', async () => {
    const anonymous = await post({ jsonrpc: '2.0', id: 1, method: 'ping' }, { authorization: '' })
    expect(anonymous.status).toBe(401)
    expect(anonymous.headers.get('www-authenticate')).toContain(
      'resource_metadata="http://localhost/.well-known/oauth-protected-resource"',
    )
    const wrong = await post(
      { jsonrpc: '2.0', id: 1, method: 'ping' },
      {
        authorization: 'Bearer nope',
      },
    )
    expect(wrong.status).toBe(401)
    const foreign = await post(
      { jsonrpc: '2.0', id: 1, method: 'ping' },
      {
        origin: 'https://evil.example',
      },
    )
    expect(foreign.status).toBe(403)
    expect((await app.request('/mcp')).status).toBe(405)
  })

  test('a revoked token, a demoted admin and a restricted profile are refused', async () => {
    world.db.$client.query("UPDATE accounts SET role = 'user'").run()
    expect((await post({ jsonrpc: '2.0', id: 1, method: 'ping' })).status).toBe(403)
    world.db.$client.query("UPDATE accounts SET role = 'admin'").run()
    world.db.$client.query("UPDATE profiles SET max_content_rating = '12'").run()
    expect((await post({ jsonrpc: '2.0', id: 1, method: 'ping' })).status).toBe(403)
    world.db.$client.query('UPDATE profiles SET max_content_rating = NULL').run()
    expect((await post({ jsonrpc: '2.0', id: 1, method: 'ping' })).status).toBe(200)
    world.db.$client
      .query("UPDATE assistant_tokens SET revoked_at = '2026-01-02T00:00:00.000Z'")
      .run()
    expect((await post({ jsonrpc: '2.0', id: 1, method: 'ping' })).status).toBe(401)
  })
})

describe('tools (§27.4, §27.5)', () => {
  test('summary, queue, one file, a TMDB season', async () => {
    await world.setKey()
    seedReview()

    const summary = await call('review_summary')
    expect(summary.structuredContent).toMatchObject({ totalToReview: 4 })
    expect(summary.structuredContent?.['toReview']).toEqual(
      expect.arrayContaining([
        { libraryId: 'library-1', library: 'library-1', reason: 'no_match', count: 3 },
        { libraryId: 'library-1', library: 'library-1', reason: 'ambiguous_match', count: 1 },
      ]),
    )

    const queue = await call('list_review_queue', { reason: 'no_match', limit: 2 })
    expect(queue.structuredContent).toMatchObject({ total: 3 })
    expect(queue.structuredContent?.['items']).toHaveLength(2)
    expect(queue.structuredContent?.['nextCursor']).toBeString()

    const detail = await call('get_review_source', { sourceId: 'ours-e1' })
    expect(detail.structuredContent).toMatchObject({
      source: { id: 'ours-e1', reason: 'no_match', parsed: { series: 'Ours', episode: 1 } },
      items: [{ id: 'local-ours-e1', kind: 'episode', episodeNumber: 1 }],
    })
    expect(
      (detail.structuredContent?.['sameFolderToReview'] as { id: string }[])
        .map((other) => other.id)
        .toSorted(),
    ).toEqual(['ours-e2', 'ours-e9'])

    const series = await call('get_tmdb_series', { tmdbId: 136315, seasonNumber: 1 })
    expect(series.structuredContent).toMatchObject({ tmdbId: 136315 })
    expect((series.structuredContent?.['season'] as { episodes: unknown[] }).episodes).toHaveLength(
      8,
    )
  })

  test('a dry run writes nothing; the real run identifies the series files', async () => {
    await world.setKey()
    seedReview()
    const assignment = { kind: 'episode', seriesTmdbId: 136315 }

    const preview = await call('assign_source', { sourceId: 'ours-e1', assignment })
    expect(preview.isError).toBeUndefined()
    expect(preview.structuredContent).toMatchObject({
      dryRun: true,
      itemIds: [],
      needsReview: [{ sourceId: 'ours-e9', seasonNumber: 1, episodeNumber: 9 }],
    })
    expect(
      (preview.structuredContent?.['identified'] as { episodeNumber: number; title: string }[])
        .map((entry) => entry.episodeNumber)
        .toSorted(),
    ).toEqual([1, 2])
    expect(world.query('SELECT * FROM manual_matches')).toEqual([])
    expect(sourceRow('Ours.S01E01.mkv')?.match_state).toBe('needs_review')

    const applied = await call('assign_source', { sourceId: 'ours-e1', assignment, dryRun: false })
    expect(applied.structuredContent).toMatchObject({ dryRun: false })
    expect(sourceRow('Ours.S01E01.mkv')?.match_state).toBe('manual')
    expect(sourceRow('Ours.S01E02.mkv')?.match_state).toBe('manual')
    expect(sourceRow('Ours.S01E09.mkv')).toMatchObject({
      match_state: 'needs_review',
      review_reason: 'episode_not_found',
    })
    expect(world.query<{ created_by: string }>('SELECT created_by FROM manual_matches')).toEqual([
      { created_by: viewer.accountId },
      { created_by: viewer.accountId },
    ])
  })

  test('an expected failure is a tool error; invalid arguments a JSON-RPC error', async () => {
    const missing = await call('hide_source', { sourceId: 'nope' })
    expect(missing.isError).toBe(true)
    expect(missing.structuredContent).toEqual({
      error: { code: 'source/not_found', message: 'source not found', context: { id: 'nope' } },
    })
    const invalid = await rpc('tools/call', { name: 'search_tmdb', arguments: { kind: 'book' } })
    expect(invalid.error?.code).toBe(-32602)
  })

  test('hide and restore; find, read and preview a rematch of a movie', async () => {
    await world.setKey()
    seedReview()
    await call('hide_source', { sourceId: 'dune' })
    expect(sourceRow('Dune.mkv')?.state).toBe('rejected')
    const hidden = await call('list_hidden_sources')
    expect(hidden.structuredContent).toMatchObject({ total: 1, items: [{ path: 'Dune.mkv' }] })
    await call('restore_source', { sourceId: 'dune' })
    expect(sourceRow('Dune.mkv')?.state).toBe('pending')

    world.db.$client.query("UPDATE sources SET state = 'ready' WHERE id = 'dune'").run()
    await call('assign_source', {
      sourceId: 'dune',
      assignment: { kind: 'movie', tmdbId: 438631 },
      dryRun: false,
    })
    const found = await call('find_items', { query: 'dune' })
    const [movie] = found.structuredContent?.['items'] as { id: string; tmdbId: number }[]
    expect(movie).toMatchObject({ tmdbId: 438631, files: 1 })
    const item = await call('get_item', { itemId: movie?.id })
    expect(item.structuredContent).toMatchObject({
      kind: 'movie',
      tmdbId: 438631,
      files: [{ sourceId: 'dune', path: 'Dune.mkv' }],
    })
    const preview = await call('rematch_item', {
      itemId: movie?.id,
      assignment: { kind: 'movie', tmdbId: 841 },
    })
    expect(preview.structuredContent).toMatchObject({
      dryRun: true,
      identified: [{ sourceId: 'dune', kind: 'movie', tmdbId: 841 }],
    })
    expect(world.query('SELECT tmdb_id FROM manual_matches')).toEqual([{ tmdb_id: 438631 }])
  })
})
