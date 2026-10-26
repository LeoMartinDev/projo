import { describe, expect, test } from 'bun:test'

import { normalizeServerUrl } from './server-url.ts'

const normalized = (input: string) => {
  const result = normalizeServerUrl(input)
  return result.ok ? result.value : result.error.code
}

describe('normalizeServerUrl', () => {
  test('keeps the scheme, host, port and path, without trailing slash', () => {
    expect(normalized('http://192.168.1.10:8080')).toBe('http://192.168.1.10:8080')
    expect(normalized('  https://projo.example.com/ ')).toBe('https://projo.example.com')
    expect(normalized('https://example.com/projo//')).toBe('https://example.com/projo')
    expect(normalized('HTTPS://Projo.Example.com')).toBe('https://projo.example.com')
  })

  test('drops the query and the fragment', () => {
    expect(normalized('http://nas.local:8080/?x=1#top')).toBe('http://nas.local:8080')
  })

  test('drops the default port', () => {
    expect(normalized('https://projo.example.com:443')).toBe('https://projo.example.com')
  })

  test('guesses plain HTTP for a home network address', () => {
    expect(normalized('192.168.1.10:8080')).toBe('http://192.168.1.10:8080')
    expect(normalized('localhost:8080')).toBe('http://localhost:8080')
    expect(normalized('nas.local')).toBe('http://nas.local')
    expect(normalized('nas:8080')).toBe('http://nas:8080')
    expect(normalized('[fd00::1]:8080')).toBe('http://[fd00::1]:8080')
  })

  test('guesses HTTPS for a domain name', () => {
    expect(normalized('projo.example.com')).toBe('https://projo.example.com')
    expect(normalized('projo.example.com/sub/')).toBe('https://projo.example.com/sub')
  })

  test('refuses what is not an http(s) server URL', () => {
    for (const input of ['', '   ', 'ftp://example.com', 'http://', 'http://user:pw@example.com'])
      expect(normalized(input)).toBe('connection/invalid_url')
  })
})

describe('normalizeServerUrl, edge cases', () => {
  test('refuses an invalid host or port', () => {
    for (const input of [
      'http://exa mple.com',
      'http://-bad.com',
      'http://nas:99999',
      'http://nas:',
    ])
      expect(normalized(input)).toBe('connection/invalid_url')
  })

  test('drops a leading zero of the port', () => {
    expect(normalized('http://nas:08080')).toBe('http://nas:8080')
  })
})
