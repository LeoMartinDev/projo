import { expect, test } from 'bun:test'

import type { SystemMediaRequest } from '@projo/web-app/host'

import { desktopSystemMedia, systemMediaRequestOf } from './system-media.ts'

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

const world = ({ failing = false, listenFails = false } = {}) => {
  const calls: { command: string; args?: Record<string, unknown> }[] = []
  const listens: string[] = []
  const handlers = new Map<string, (payload: unknown) => void>()
  const warnings: string[] = []
  const media = desktopSystemMedia(
    {
      invoke: async (command, args) => {
        calls.push(args === undefined ? { command } : { command, args })
        if (failing) throw new Error('no such command')
        return undefined
      },
      listen: async (event, handle) => {
        listens.push(event)
        if (listenFails) throw new Error('no event plugin')
        handlers.set(event, handle)
        return () => undefined
      },
    },
    (message) => warnings.push(message),
  )
  const emit = (payload: unknown) => handlers.get('media://action')?.(payload)
  return { media, calls, listens, warnings, emit }
}

test('sets what plays, without the keys it lacks', async () => {
  const { media, calls } = world()
  media.set({
    title: 'S1 · E3',
    subtitle: 'Severance',
    artworkUrl: 'http://nas.local:8080/api/v1/images/p1?w=500&key=k',
    actions: ['play', 'pause', 'nexttrack'],
  })
  media.set({ title: 'Heat', actions: ['play'] })
  await flush()
  expect(calls).toEqual([
    {
      command: 'media_session_set',
      args: {
        title: 'S1 · E3',
        subtitle: 'Severance',
        artworkUrl: 'http://nas.local:8080/api/v1/images/p1?w=500&key=k',
        actions: ['play', 'pause', 'nexttrack'],
      },
    },
    { command: 'media_session_set', args: { title: 'Heat', actions: ['play'] } },
  ])
  expect(Object.keys(calls[1]?.args ?? {})).toEqual(['title', 'actions'])
})

test('posts the position in whole milliseconds, and clears without arguments', async () => {
  const { media, calls } = world()
  media.position({ playing: true, positionMs: 12_345.6, durationMs: 99_999.4, rate: 1.25 })
  media.clear()
  await flush()
  expect(calls).toEqual([
    {
      command: 'media_session_state',
      args: { playing: true, positionMs: 12_346, durationMs: 99_999, rate: 1.25 },
    },
    { command: 'media_session_clear' },
  ])
})

test('a refused command is warned about, never thrown', async () => {
  const { media, warnings } = world({ failing: true })
  expect(() => media.set({ title: 'Heat', actions: [] })).not.toThrow()
  media.clear()
  await flush()
  expect(warnings).toEqual(['media_session_set failed', 'media_session_clear failed'])
})

test('listens once, on the first listener, and dispatches the actions it understands', async () => {
  const { media, listens, emit } = world()
  expect(listens).toEqual([])
  const first: SystemMediaRequest[] = []
  const second: SystemMediaRequest[] = []
  const stopFirst = media.onAction((request) => first.push(request))
  media.onAction((request) => second.push(request))
  await flush()
  expect(listens).toEqual(['media://action'])
  emit({ action: 'pause' })
  emit({ action: 'seekto', seekTimeMs: 90_000 })
  stopFirst()
  emit({ action: 'nexttrack', seekTimeMs: 5 })
  expect(first).toEqual([{ action: 'pause' }, { action: 'seekto', seekTimeMs: 90_000 }])
  expect(second).toEqual([
    { action: 'pause' },
    { action: 'seekto', seekTimeMs: 90_000 },
    { action: 'nexttrack' },
  ])
})

test('drops payloads it does not understand', async () => {
  const { media, emit } = world()
  const received: SystemMediaRequest[] = []
  media.onAction((request) => received.push(request))
  await flush()
  for (const payload of [
    undefined,
    'play',
    {},
    { action: 'stop' },
    { action: 42 },
    { action: 'seekto' },
    { action: 'seekto', seekTimeMs: -1 },
    { action: 'seekto', seekTimeMs: Number.NaN },
    { action: 'seekto', seekTimeMs: '1000' },
  ])
    emit(payload)
  expect(received).toEqual([])
  expect(systemMediaRequestOf({ action: 'seekto', seekTimeMs: 0 })).toEqual({
    action: 'seekto',
    seekTimeMs: 0,
  })
})

test('a failed listen is warned about and tried again on the next listener', async () => {
  const { media, listens, warnings } = world({ listenFails: true })
  media.onAction(() => undefined)
  await flush()
  expect(warnings).toEqual(['listening to media://action failed'])
  media.onAction(() => undefined)
  await flush()
  expect(listens).toEqual(['media://action', 'media://action'])
})
