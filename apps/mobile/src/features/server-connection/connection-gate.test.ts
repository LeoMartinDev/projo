import { describe, expect, test } from 'bun:test'

import { connectionError } from './connection-error.ts'
import { connectionGate } from './connection-gate.ts'

const url = 'http://nas.local:8080'
const unreachable = connectionError('network', 'server unreachable')

describe('connectionGate', () => {
  test('waits for the stored URL', () => {
    expect(connectionGate({ stored: { loaded: false }, health: {} })).toEqual({ kind: 'loading' })
  })

  test('no stored URL: the connection screen', () => {
    expect(connectionGate({ stored: { loaded: true }, health: {} })).toEqual({
      kind: 'disconnected',
    })
  })

  test('a stored URL being checked: still loading', () => {
    expect(connectionGate({ stored: { loaded: true, url }, health: {} })).toEqual({
      kind: 'loading',
    })
  })

  test('a compatible server: connected, with its version', () => {
    expect(
      connectionGate({
        stored: { loaded: true, url },
        health: { status: { kind: 'compatible', version: '1.4.0' } },
      }),
    ).toEqual({ kind: 'connected', url, version: '1.4.0' })
  })

  test('an older server: the blocking update screen', () => {
    expect(
      connectionGate({
        stored: { loaded: true, url },
        health: { status: { kind: 'outdated', version: '1.3.0', minimumVersion: '1.4.0' } },
      }),
    ).toEqual({ kind: 'outdated', url, version: '1.3.0', minimumVersion: '1.4.0' })
  })

  test('a failed re-check keeps the last answer', () => {
    expect(
      connectionGate({
        stored: { loaded: true, url },
        health: { status: { kind: 'compatible', version: '1.4.0' }, error: unreachable },
      }),
    ).toMatchObject({ kind: 'connected' })
  })

  test('a server never reached: the connection screen, URL and error kept', () => {
    expect(
      connectionGate({ stored: { loaded: true, url }, health: { error: unreachable } }),
    ).toEqual({ kind: 'disconnected', url, error: unreachable })
  })
})
