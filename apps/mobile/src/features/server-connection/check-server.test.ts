import { describe, expect, test } from 'bun:test'

import { checkServerFactory, type HealthFetch } from './check-server.ts'

const respond =
  (status: number, body: unknown): HealthFetch =>
  async () => ({ ok: status >= 200 && status < 300, status, json: async () => body })

const check = (fetch: HealthFetch, minimumServerVersion = '1.4.0') =>
  checkServerFactory({ fetch, minimumServerVersion, timeoutMs: 1_000 })

const health = (version: string) => ({ status: 'ok', version, runtime: '1.0.0' })

describe('checkServer', () => {
  test('requests <server>/health', async () => {
    const urls: string[] = []
    const fetch: HealthFetch = async (url) => {
      urls.push(url)
      return { ok: true, status: 200, json: async () => health('1.4.0') }
    }
    await check(fetch)('http://nas.local:8080')
    expect(urls).toEqual(['http://nas.local:8080/health'])
  })

  test('a server at or above the minimum is compatible', async () => {
    expect(await check(respond(200, health('1.4.0')))('http://s')).toEqual({
      ok: true,
      value: { kind: 'compatible', version: '1.4.0' },
    })
    expect(await check(respond(200, health('2.0.0')))('http://s')).toMatchObject({
      ok: true,
      value: { kind: 'compatible', version: '2.0.0' },
    })
  })

  test('an older server is outdated, with both versions', async () => {
    expect(await check(respond(200, health('1.3.9')))('http://s')).toEqual({
      ok: true,
      value: { kind: 'outdated', version: '1.3.9', minimumVersion: '1.4.0' },
    })
    expect(await check(respond(200, health('1.4.0-rc.1')))('http://s')).toMatchObject({
      ok: true,
      value: { kind: 'outdated' },
    })
  })

  test('unknown fields of the response are ignored (§17.1)', async () => {
    const body = { ...health('1.5.0'), uptime: 42, features: ['pairing'] }
    expect(await check(respond(200, body))('http://s')).toMatchObject({
      ok: true,
      value: { kind: 'compatible', version: '1.5.0' },
    })
  })

  test('anything but a projo health response is not projo', async () => {
    for (const fetch of [
      respond(200, { hello: 'world' }),
      respond(200, '<html></html>'),
      respond(200, health('dev')),
      respond(404, { error: 'not found' }),
      respond(401, undefined),
      async () => ({
        ok: true,
        status: 200,
        json: async () => Promise.reject(new SyntaxError('json')),
      }),
    ] satisfies HealthFetch[])
      expect(await check(fetch)('http://s')).toMatchObject({
        ok: false,
        error: { code: 'connection/not_projo', context: { url: 'http://s' } },
      })
  })

  test('a refused connection or a 5xx is a network failure', async () => {
    const refused: HealthFetch = async () => Promise.reject(new TypeError('Network request failed'))
    expect(await check(refused)('http://s')).toMatchObject({
      ok: false,
      error: { code: 'network' },
    })
    expect(await check(respond(502, undefined))('http://s')).toMatchObject({
      ok: false,
      error: { code: 'network', context: { status: 502 } },
    })
  })

  test('gives up after the timeout', async () => {
    const hanging: HealthFetch = (_url, { signal }) =>
      new Promise((_resolve, reject) =>
        signal.addEventListener('abort', () => reject(signal.reason)),
      )
    const result = await checkServerFactory({
      fetch: hanging,
      minimumServerVersion: '1.4.0',
      timeoutMs: 10,
    })('http://s')
    expect(result).toMatchObject({ ok: false, error: { code: 'network' } })
  })

  test('a minimum that is not semver is a bug', () => {
    expect(() => check(respond(200, health('1.4.0')), 'latest')).toThrow()
  })
})
