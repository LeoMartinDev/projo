import { beforeEach, describe, expect, test } from 'bun:test'

import type { TvProviderChannel } from '../../core/tv/provider.ts'
import { createTvWorld, type TvWorld } from '../../../test/support/tv-world.ts'

const day = 24 * 60 * 60_000

const entry = (name: string, group: string, extra: Partial<TvProviderChannel> = {}) => ({
  key: `name:${group}|${name}`,
  name,
  group,
  upstream: { url: `http://p/${encodeURIComponent(name)}.ts` },
  ...extra,
})

let world: TvWorld
let sourceId: string
beforeEach(() => {
  world = createTvWorld()
  sourceId = world.createTvSource({
    name: 'Provider',
    settings: { kind: 'm3u', playlistUrl: 'http://p/get.php?password=secret' },
  }).id
})

const refresh = async () => {
  const result = await world.refreshTvSource({ sourceId })
  if (!result.ok) throw new Error(result.error.message)
  return result.value
}

const channelNamed = (name: string) =>
  [...world.channels.channels.values()].find((channel) => channel.name === name)

describe('refreshTvSource', () => {
  test('creates groups and disabled channels, records the success and queues the logos', async () => {
    world.provider.answer({
      channels: [entry('A', 'News'), entry('B', '')],
      guideUrl: 'http://p/epg.xml',
    })
    expect(await refresh()).toEqual({ listed: 2, added: 2, updated: 0, missing: 0, deleted: 0 })
    expect(world.getTvSource({ id: sourceId })).toMatchObject({
      ok: true,
      value: {
        channelCount: 2,
        enabledChannelCount: 0,
        state: 'ready',
        failureCount: 0,
        discoveredGuideUrl: 'http://p/epg.xml',
        groups: [
          { name: 'News', enabled: false, channelCount: 1 },
          { name: '', enabled: false, channelCount: 1 },
        ],
      },
    })
    expect(world.enqueued.map((job) => [job.type, job.dedupeKey])).toEqual([
      ['refresh_tv_source', `tv_source:${sourceId}`],
      ['fetch_tv_logos', `tv_logos:${sourceId}`],
    ])
  })

  test('keeps channel ids across refreshes and enables new channels of an enabled group', async () => {
    world.provider.answer({ channels: [entry('A', 'News'), entry('K', 'Kids')] })
    await refresh()
    const a = channelNamed('A')
    const news = world.channels.repository.groupsOf(sourceId).find((g) => g.name === 'News')
    if (a === undefined || news === undefined) throw new Error('not created')
    world.setTvGroupEnabled({ sourceId, groupId: news.id, enabled: true })

    world.provider.answer({
      channels: [entry('A', 'News', { number: 7 }), entry('B', 'News'), entry('K2', 'Kids')],
    })
    expect(await refresh()).toMatchObject({ added: 2, updated: 1, missing: 1 })
    expect(channelNamed('A')).toMatchObject({ id: a.id, enabled: true, number: 7 })
    expect(channelNamed('B')?.enabled).toBe(true)
    expect(channelNamed('K2')?.enabled).toBe(false)
  })

  test('hides a channel gone from the source and deletes it with its logo after 7 days', async () => {
    world.provider.answer({ channels: [entry('A', 'News'), entry('B', 'Kids')] })
    await refresh()
    const b = channelNamed('B')
    if (b === undefined) throw new Error('not created')
    world.channels.channels.set(b.id, { ...b, logoPath: `tv/${b.id}.png` })
    world.logos.files.set(`tv/${b.id}.png`, new Uint8Array([1]))

    world.provider.answer({ channels: [entry('A', 'News')] })
    await refresh()
    expect(world.getTvSource({ id: sourceId })).toMatchObject({
      ok: true,
      value: { channelCount: 1, groups: [{ name: 'News' }, { name: 'Kids', channelCount: 0 }] },
    })

    world.clock.advance(7 * day)
    expect(await refresh()).toMatchObject({ deleted: 1 })
    expect(world.channels.channels.has(b.id)).toBe(false)
    expect(world.logos.files.size).toBe(0)
    expect(world.channels.repository.groupsOf(sourceId).map((g) => g.name)).toEqual(['News'])
  })

  test('a failure changes no channel; the third in a row notifies, a success resolves', async () => {
    world.provider.answer({ channels: [entry('A', 'News')] })
    await refresh()
    world.provider.fail('tv/source_unreachable')
    for (const expected of [1, 2]) {
      const result = await world.refreshTvSource({ sourceId })
      expect(result).toMatchObject({ ok: false, error: { code: 'tv/source_unreachable' } })
      expect(world.sources.rows.get(sourceId)?.failureCount).toBe(expected)
      expect(world.notifications.open.size).toBe(0)
    }
    world.provider.fail('tv/source_invalid')
    await world.refreshTvSource({ sourceId })
    expect(world.notifications.log).toEqual([
      `notify tv/source_unreachable ${JSON.stringify({ tvSourceId: sourceId, name: 'Provider', code: 'tv/source_invalid', failures: 3 })}`,
    ])
    expect(world.getTvSource({ id: sourceId })).toMatchObject({
      ok: true,
      value: {
        state: 'error',
        lastError: { code: 'tv/source_invalid' },
        channelCount: 1,
      },
    })

    world.provider.answer({ channels: [entry('A', 'News')] })
    await refresh()
    expect(world.notifications.log.at(-1)).toBe('resolve tv/source_unreachable')
    expect(world.sources.rows.get(sourceId)).toMatchObject({ failureCount: 0 })
    expect(world.sources.rows.get(sourceId)?.lastError).toBeUndefined()
  })

  test('a failure while the server stops is not counted', async () => {
    world.provider.fail()
    const controller = new AbortController()
    controller.abort()
    await world.refreshTvSource({ sourceId, signal: controller.signal })
    expect(world.sources.rows.get(sourceId)?.failureCount).toBe(0)
  })

  test('a source deleted meanwhile is skipped', async () => {
    await world.deleteTvSource({ id: sourceId })
    expect(await world.refreshTvSource({ sourceId })).toEqual({ ok: true, value: undefined })
    expect(world.provider.calls).toEqual([])
  })
})
