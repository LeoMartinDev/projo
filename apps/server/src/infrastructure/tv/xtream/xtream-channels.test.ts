import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { iptvFixturesDir } from '../../../../test/support/iptv-server.ts'
import { xtreamAccountOf } from './xtream-api.ts'
import {
  accountLimitOf,
  accountRefusalOf,
  outputFormatOf,
  xtreamCategoriesOf,
  xtreamChannelsOf,
  xtreamStreamsOf,
  xtreamStreamUrlOf,
} from './xtream-channels.ts'

const fixture = (name: string): unknown =>
  JSON.parse(
    readFileSync(join(iptvFixturesDir, 'xtream', name), 'utf8').replaceAll(
      '{{base}}',
      'http://panel.test:8080',
    ),
  ) as unknown

const list = (name: string): unknown[] => {
  const value = fixture(name)
  if (!Array.isArray(value)) throw new Error(`${name} is not a list`)
  return value
}

/** A `null` as panels send it (the code itself never writes one, §5.3). */
const jsonNull: unknown = JSON.parse('null')

const now = new Date('2026-11-18T12:00:00Z')
const nowSeconds = now.getTime() / 1000

describe('xtream account (§29.2)', () => {
  const account = (userInfo: Record<string, unknown>) => {
    const parsed = xtreamAccountOf({ user_info: { auth: 1, status: 'Active', ...userInfo } })
    if (parsed === undefined) throw new Error('not an account')
    return parsed
  }

  test("the fixture's account is usable, numbers written as strings", () => {
    const parsed = xtreamAccountOf(fixture('account.json'))
    if (parsed === undefined) throw new Error('not an account')
    expect(accountRefusalOf(parsed, now)).toBeUndefined()
    expect(accountLimitOf(parsed)).toEqual({ maxConnections: 2 })
    expect(outputFormatOf(parsed)).toBe('ts')
  })

  test('not the shape: no user_info object', () => {
    expect(xtreamAccountOf([])).toBeUndefined()
    expect(xtreamAccountOf({ user_info: 'x' })).toBeUndefined()
    expect(xtreamAccountOf('<html>')).toBeUndefined()
  })

  test('refusals: credentials, status, expiry', () => {
    expect(accountRefusalOf(account({ auth: 0 }), now)).toBe('auth_failed')
    expect(accountRefusalOf(account({ auth: '0' }), now)).toBe('auth_failed')
    expect(accountRefusalOf(account({ auth: undefined }), now)).toBe('auth_failed')
    expect(accountRefusalOf(account({ auth: '1' }), now)).toBeUndefined()
    expect(accountRefusalOf(account({ status: 'Expired' }), now)).toBe('expired')
    expect(accountRefusalOf(account({ status: 'Banned' }), now)).toBe('banned')
    expect(accountRefusalOf(account({ status: 'disabled' }), now)).toBe('disabled')
    expect(accountRefusalOf(account({ status: 'Inactive' }), now)).toBe('inactive')
    expect(accountRefusalOf(account({ status: 'ACTIVE' }), now)).toBeUndefined()
    expect(accountRefusalOf(account({ exp_date: String(nowSeconds - 60) }), now)).toBe('expired')
    expect(accountRefusalOf(account({ exp_date: nowSeconds + 60 }), now)).toBeUndefined()
    expect(accountRefusalOf(account({ exp_date: jsonNull }), now)).toBeUndefined()
  })

  test('the connection limit: a positive integer, else none', () => {
    expect(accountLimitOf(account({ max_connections: 3 }))).toEqual({ maxConnections: 3 })
    expect(accountLimitOf(account({ max_connections: '0' }))).toEqual({})
    expect(accountLimitOf(account({ max_connections: jsonNull }))).toEqual({})
    expect(accountLimitOf(account({ max_connections: 'unlimited' }))).toEqual({})
  })

  test('output format: ts when allowed or unsaid, else m3u8, else none', () => {
    expect(outputFormatOf(account({ allowed_output_formats: ['m3u8', 'ts'] }))).toBe('ts')
    expect(outputFormatOf(account({ allowed_output_formats: [] }))).toBe('ts')
    expect(outputFormatOf(account({ allowed_output_formats: jsonNull }))).toBe('ts')
    expect(outputFormatOf(account({ allowed_output_formats: ['M3U8', 'rtmp'] }))).toBe('m3u8')
    expect(outputFormatOf(account({ allowed_output_formats: ['rtmp'] }))).toBeUndefined()
  })
})

describe('xtream channels (§29.2)', () => {
  const channels = (format: 'ts' | 'm3u8' = 'ts') =>
    xtreamChannelsOf({
      categories: xtreamCategoriesOf(list('categories.json')),
      streams: xtreamStreamsOf(list('streams.json')),
      format,
    })

  test('live entries only, by category order, then num; panel quirks read leniently', () => {
    expect(channels()).toEqual([
      {
        key: 'stream:103',
        name: 'Sport One',
        group: 'Sports',
        upstream: { url: 'live/103.ts' },
      },
      {
        key: 'stream:101',
        name: 'News One',
        number: 1,
        group: 'News',
        logoUrl: 'http://panel.test:8080/logos/news-one.png',
        upstream: { url: 'live/101.ts' },
        guideKey: 'news.one',
      },
      {
        key: 'stream:102',
        name: 'News Two',
        number: 2,
        group: 'News',
        upstream: { url: 'live/102.ts' },
      },
      {
        key: 'stream:110',
        name: 'Interlaced TV',
        number: 7,
        group: '',
        upstream: { url: 'live/110.ts' },
      },
    ])
  })

  test('the stored upstream holds no credential and takes the output format', () => {
    for (const channel of channels('m3u8'))
      expect(channel.upstream.url).toMatch(/^live\/\d+\.m3u8$/u)
  })
})

describe('xtream stream URL (§29.2)', () => {
  const settings = {
    kind: 'xtream' as const,
    serverUrl: 'https://panel.test:8443/',
    username: 'jo',
    password: 'p@ss/w rd',
  }

  test('built from the current settings, credentials percent-encoded and named as secrets', () => {
    expect(xtreamStreamUrlOf(settings, { url: 'live/42.m3u8' })).toEqual({
      url: 'https://panel.test:8443/live/jo/p%40ss%2Fw%20rd/42.m3u8',
      // Raw: `maskUrls` masks their percent-encoded forms too, and `jo` as a token only.
      secrets: ['jo', 'p@ss/w rd'],
    })
  })

  test('anything but a stored Xtream path is not one', () => {
    expect(xtreamStreamUrlOf(settings, { url: 'http://elsewhere/live/42.ts' })).toBeUndefined()
    expect(xtreamStreamUrlOf(settings, { url: 'live/../42.ts' })).toBeUndefined()
  })
})
