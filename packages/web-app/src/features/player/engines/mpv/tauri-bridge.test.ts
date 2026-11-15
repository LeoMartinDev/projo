import { expect, test } from 'bun:test'

import { eventMessage, propertyMessage } from './tauri-bridge.ts'

test('mpv://property payloads: an absent or JSON null value is no value', () => {
  expect(propertyMessage({ name: 'time-pos', value: 12.5 })).toEqual({
    kind: 'property',
    name: 'time-pos',
    value: 12.5,
  })
  expect(propertyMessage({ name: 'duration' })).toEqual({ kind: 'property', name: 'duration' })
  expect(propertyMessage(JSON.parse('{"name":"duration","value":null}'))).toEqual({
    kind: 'property',
    name: 'duration',
  })
  expect(propertyMessage({ value: 1 })).toBeUndefined()
})

test('mpv://event payloads of the IPC contract only', () => {
  expect(eventMessage({ event: 'end-file', reason: 'error', error: 'loading failed' })).toEqual({
    kind: 'event',
    event: 'end-file',
    reason: 'error',
    error: 'loading failed',
  })
  expect(eventMessage({ event: 'file-loaded' })).toEqual({ kind: 'event', event: 'file-loaded' })
  expect(eventMessage({ event: 'end-file', reason: 'unknown' })).toEqual({
    kind: 'event',
    event: 'end-file',
  })
  expect(eventMessage({ event: 'client-message' })).toBeUndefined()
})
