import { expect, test } from 'bun:test'

import { err, ok } from '@projo/shared/result'

import { startingStep, stepAfter } from './entry-flow.ts'

const nas = 'http://nas.local:8080'

test('first launch asks for the address; a saved server connects at once', () => {
  expect(startingStep({ saved: undefined, changing: false })).toEqual({
    kind: 'address',
    serverUrl: '',
  })
  expect(startingStep({ saved: nas, changing: false })).toEqual({ connect: nas })
})

test('"Change server" asks again, with the saved address filled in', () => {
  expect(startingStep({ saved: nas, changing: true })).toEqual({ kind: 'address', serverUrl: nas })
})

test('a server ready, too old or not set up is its own step, however it was reached', () => {
  for (const source of ['typed', 'saved'] as const) {
    expect(stepAfter(nas, source, ok({ kind: 'ready', serverUrl: nas }))).toEqual({
      kind: 'ready',
      serverUrl: nas,
    })
    expect(
      stepAfter(nas, source, ok({ kind: 'outdated', serverUrl: nas, version: '1.24.0' })),
    ).toEqual({ kind: 'outdated', serverUrl: nas, version: '1.24.0' })
    expect(stepAfter(nas, source, ok({ kind: 'not_set_up', serverUrl: nas }))).toEqual({
      kind: 'not_set_up',
      serverUrl: nas,
    })
  }
})

test('a typed address that fails stays on the address screen with why', () => {
  expect(
    stepAfter('nas', 'typed', err({ code: 'server/unreachable', message: 'timed out' })),
  ).toEqual({ kind: 'address', serverUrl: 'nas', error: 'server/unreachable' })
})

test('the saved server failing is unreachable; a failure to save stays an address error', () => {
  expect(stepAfter(nas, 'saved', err({ code: 'server/unreachable', message: 'x' }))).toEqual({
    kind: 'unreachable',
    serverUrl: nas,
  })
  expect(stepAfter(nas, 'saved', err({ code: 'server/not_projo', message: 'x' }))).toEqual({
    kind: 'unreachable',
    serverUrl: nas,
  })
  expect(stepAfter(nas, 'saved', err({ code: 'desktop/config_not_saved', message: 'x' }))).toEqual({
    kind: 'address',
    serverUrl: nas,
    error: 'desktop/config_not_saved',
  })
})
