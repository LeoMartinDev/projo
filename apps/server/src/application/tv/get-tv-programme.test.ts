import { beforeEach, expect, test } from 'bun:test'

import { createTvWorld, type TvWorld } from '../../../test/support/tv-world.ts'

const hour = 60 * 60_000

let world: TvWorld
let channelId: string
const minutes = (value: number) => new Date(world.clock.now().getTime() + value * 60_000)
const idOf = (title: string) => world.guide.programmes().find((p) => p.title === title)?.id ?? ''

beforeEach(async () => {
  world = createTvWorld()
  const sourceId = world.addTvSource({
    name: 'A',
    settings: { kind: 'm3u', playlistUrl: 'http://a/list.m3u' },
  }).id
  world.provider.answer({
    channels: [
      { key: 'c', name: 'C', group: '', upstream: { url: 'http://a/c.ts' }, guideKey: 'c' },
    ],
  })
  await world.refreshTvSource({ sourceId })
  channelId = [...world.channels.channels.keys()][0] ?? ''
  world.setTvChannelEnabled({ id: channelId, enabled: true })
  const programme = (from: number, to: number, title: string) => ({
    channel: 'c',
    start: minutes(from),
    stop: minutes(to),
    titles: [{ text: title }],
    subtitles: [],
    descriptions: [{ text: `${title}, in full.` }],
    categories: [{ lang: 'fr', text: 'Film' }],
  })
  world.provider.guide({
    programmes: [programme(-30, 30, 'Now'), programme(30, 90, 'Next'), programme(90, 120, 'Then')],
  })
  await world.refreshTvGuide({ sourceId })
})

test('a programme in full with the one that follows it (§29.7)', () => {
  expect(world.getTvProgramme({ programmeId: idOf('Now'), profileId: 'p' })).toMatchObject({
    ok: true,
    value: {
      programme: { title: 'Now', description: 'Now, in full.', kind: 'movie' },
      next: { title: 'Next' },
    },
  })
  const last = world.getTvProgramme({ programmeId: idOf('Then'), profileId: 'p' })
  expect(last.ok && last.value.next).toBeUndefined()
})

test('not found: unknown, a disabled channel, no Live TV access, ended over 6 hours ago', () => {
  const notFound = { ok: false, error: { code: 'tv/programme_not_found' } }
  expect(world.getTvProgramme({ programmeId: 'nope', profileId: 'p' })).toMatchObject(notFound)
  world.withoutLiveTv.add('p')
  expect(world.getTvProgramme({ programmeId: idOf('Now'), profileId: 'p' })).toMatchObject(notFound)
  world.withoutLiveTv.delete('p')
  const id = idOf('Now')
  world.clock.advance(6 * hour + 30 * 60_000 + 1)
  expect(world.getTvProgramme({ programmeId: id, profileId: 'p' })).toMatchObject(notFound)
  world.setTvChannelEnabled({ id: channelId, enabled: false })
  expect(world.getTvProgramme({ programmeId: idOf('Then'), profileId: 'p' })).toMatchObject(
    notFound,
  )
})
