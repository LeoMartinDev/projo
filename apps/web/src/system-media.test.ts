import { expect, test } from 'bun:test'

import type { SystemMediaRequest } from '@projo/web-app/host'

import { browserSystemMedia } from './system-media.ts'

const world = () => {
  const handlers = new Map<string, ((details: { seekTime?: number }) => void) | undefined>()
  const positions: MediaPositionState[] = []
  const fake = {
    metadata: undefined as MediaMetadataInit | undefined,
    setActionHandler: (
      action: string,
      handler: ((details: { seekTime?: number }) => void) | undefined,
    ) => {
      handlers.set(action, handler)
    },
    setPositionState: (state: MediaPositionState) => {
      positions.push(state)
    },
  }
  const media = browserSystemMedia({
    session: fake as unknown as MediaSession,
    metadataOf: (init) => init as MediaMetadata,
  })
  const received: SystemMediaRequest[] = []
  media.onAction((request) => received.push(request))
  return { media, fake, handlers, positions, received }
}

test('sets the Media Session: the line as the title, the series as the artist, the poster', () => {
  const { media, fake, handlers } = world()
  media.set({
    title: 'S1 · E3',
    subtitle: 'Severance',
    artworkUrl: '/api/v1/images/p1?w=500',
    actions: ['play', 'pause', 'seekbackward', 'seekforward', 'seekto'],
  })
  expect(fake.metadata).toEqual({
    title: 'S1 · E3',
    artist: 'Severance',
    artwork: [{ src: '/api/v1/images/p1?w=500', sizes: '500x750' }],
  })
  expect(handlers.get('play')).toBeFunction()
  expect(handlers.has('nexttrack')).toBe(true)
  expect(handlers.get('nexttrack')).toBeUndefined()
  media.set({ title: 'Heat', actions: [] })
  expect(fake.metadata).toEqual({ title: 'Heat' })
})

test('dispatches the actions, seekto in milliseconds and only with a time', () => {
  const { media, handlers, received } = world()
  media.set({
    title: 'Heat',
    actions: ['play', 'pause', 'seekbackward', 'seekforward', 'seekto', 'nexttrack'],
  })
  handlers.get('pause')?.({})
  handlers.get('seekto')?.({ seekTime: 12.5 })
  handlers.get('seekto')?.({})
  handlers.get('nexttrack')?.({})
  expect(received).toEqual([
    { action: 'pause' },
    { action: 'seekto', seekTimeMs: 12_500 },
    { action: 'nexttrack' },
  ])
})

test('posts the position in seconds; clearing removes every handler and the metadata', () => {
  const { media, fake, handlers, positions } = world()
  media.set({ title: 'Heat', actions: ['play', 'nexttrack'] })
  media.position({ playing: true, positionMs: 12_500, durationMs: 100_000, rate: 1.5 })
  expect(positions).toEqual([{ duration: 100, position: 12.5, playbackRate: 1.5 }])
  media.clear()
  expect(fake.metadata).toBeUndefined()
  expect([...handlers.values()].every((handler) => handler === undefined)).toBe(true)
  expect(handlers.size).toBe(6)
})
