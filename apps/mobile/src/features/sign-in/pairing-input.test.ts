import { describe, expect, test } from 'bun:test'

import { pairingUrl } from '@projo/shared/api/auth'

import { normalizePairingCode, parsePairingLink, parseTypedPairing } from './pairing-input.ts'

const outcome = <T>(
  result: { ok: true; value: T } | { ok: false; error: { code: string } },
): T | string => (result.ok ? result.value : result.error.code)

describe('normalizePairingCode', () => {
  test('ignores case, spaces and dashes, as the server does', () => {
    for (const input of ['ABC234', 'abc234', 'abc 234', ' ABC-234 ', 'a b c - 2 3 4', 'ABC–234'])
      expect(outcome(normalizePairingCode(input))).toBe('ABC234')
  })

  test('refuses what cannot be a code: length, or a character outside the alphabet', () => {
    for (const input of ['', 'ABC23', 'ABC2345', 'ABC0DE', 'ABCIDE', 'ABC1DE', 'ABCODE', 'AB.234'])
      expect(outcome(normalizePairingCode(input))).toBe('auth/pairing_invalid')
  })
})

describe('parsePairingLink', () => {
  test('reads the QR code of "Connect a device": the origin is the server', () => {
    const link = pairingUrl({ origin: 'http://192.168.1.10:8080', code: 'K7MXQ2' })
    expect(outcome(parsePairingLink(link))).toEqual({
      code: 'K7MXQ2',
      serverUrl: 'http://192.168.1.10:8080',
    })
  })

  test('normalizes the server URL and the code', () => {
    expect(outcome(parsePairingLink('HTTPS://Projo.Example.com:443/pair?code=k7mxq2'))).toEqual({
      code: 'K7MXQ2',
      serverUrl: 'https://projo.example.com',
    })
  })

  test('keeps a path prefix, tolerates other parameters and a fragment', () => {
    expect(
      outcome(parsePairingLink('https://example.com/projo/pair/?utm=x&code=K7MXQ2&y=1#top')),
    ).toEqual({ code: 'K7MXQ2', serverUrl: 'https://example.com/projo' })
  })

  test('a QR code that is not a projo pairing link', () => {
    for (const text of [
      'https://example.com',
      'https://example.com/pair',
      'https://example.com/pair?token=K7MXQ2',
      'K7MXQ2',
      'WIFI:S:home;T:WPA;P:secret;;',
    ])
      expect(outcome(parsePairingLink(text))).toBe('pairing/not_a_code')
  })

  test('a pairing link with a bad origin or code', () => {
    expect(outcome(parsePairingLink('ftp://example.com/pair?code=K7MXQ2'))).toBe(
      'connection/invalid_url',
    )
    expect(outcome(parsePairingLink('https://example.com/pair?code=K7MX'))).toBe(
      'auth/pairing_invalid',
    )
  })
})

describe('parseTypedPairing', () => {
  test('a typed code names no server', () => {
    expect(outcome(parseTypedPairing('k7m xq2'))).toEqual({ code: 'K7MXQ2' })
  })

  test('a pasted link names its server', () => {
    expect(outcome(parseTypedPairing(' http://nas.local:8080/pair?code=K7MXQ2 '))).toEqual({
      code: 'K7MXQ2',
      serverUrl: 'http://nas.local:8080',
    })
  })

  test('anything else is an invalid code', () => {
    expect(outcome(parseTypedPairing('hello'))).toBe('auth/pairing_invalid')
  })
})
