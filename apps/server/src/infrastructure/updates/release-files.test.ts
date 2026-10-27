import { describe, expect, test } from 'bun:test'

import {
  isReleaseDownloadUrl,
  isSafeBundlePath,
  parseChecksums,
  parseReleaseManifest,
  parseSwitchReport,
} from './release-files.ts'

const hash = 'ab'.repeat(32)

describe('release files', () => {
  test('bundle paths stay inside the bundle', () => {
    expect(isSafeBundlePath('public/index.html')).toBe(true)
    for (const path of ['', '/etc/passwd', '../x', 'a/../../x', 'a//b', './a', 'a\\b', 'C:/x'])
      expect(isSafeBundlePath(path)).toBe(false)
  })

  test('release file URLs stay under the download prefix once parsed', () => {
    const prefix = 'https://github.com/LeoMartinDev/projo/releases/download/'
    expect(isReleaseDownloadUrl(`${prefix}v1.6.0/SHA256SUMS`, prefix)).toBe(true)
    expect(
      isReleaseDownloadUrl(
        'http://127.0.0.1:4000/download/v1.6.0/a',
        'http://127.0.0.1:4000/download/',
      ),
    ).toBe(true)
    for (const url of [
      'https://evil.example/LeoMartinDev/projo/releases/download/v1.6.0/SHA256SUMS',
      'http://github.com/LeoMartinDev/projo/releases/download/v1.6.0/SHA256SUMS',
      `${prefix}../../../../attacker/x/releases/download/v1/SHA256SUMS`,
      `${prefix}%2e%2e/%2E%2E/%2e./.%2e/attacker/x`,
      `${prefix}v1/..%2f..%2fattacker`,
      'https://github.com/LeoMartinDev/projo/releases/downloadx/v1/a',
      'not a url',
    ])
      expect(isReleaseDownloadUrl(url, prefix)).toBe(false)
  })

  test('SHA256SUMS in text and binary mode', () => {
    const sums = parseChecksums(
      `${hash}  projo-app-1.4.0.tar.gz\r\n${hash.toUpperCase()} *manifest.json\nnoise\n`,
    )
    expect([...sums]).toEqual([
      ['projo-app-1.4.0.tar.gz', hash],
      ['manifest.json', hash],
    ])
  })

  test('a manifest must list server.js and only safe paths', () => {
    const base = { version: '1.4.0', runtimeMin: '0.1.0', builtAt: '2026-10-24T00:00:00.000Z' }
    expect(parseReleaseManifest({ ...base, files: { 'server.js': hash } }).ok).toBe(true)
    expect(parseReleaseManifest({ ...base, files: { 'public/a.js': hash } })).toMatchObject({
      ok: false,
    })
    expect(
      parseReleaseManifest({ ...base, files: { 'server.js': hash, '../x': hash } }),
    ).toMatchObject({ ok: false, reason: 'unsafe path ../x' })
  })

  test('switch report of the supervisor', () => {
    expect(
      parseSwitchReport({
        fromVersion: '1.3.0',
        toVersion: '1.4.0',
        outcome: 'rolled_back',
        at: '2026-10-24T09:00:00.000Z',
        reason: 'health_timeout',
      }),
    ).toEqual({
      fromVersion: '1.3.0',
      toVersion: '1.4.0',
      outcome: 'rolled_back',
      at: new Date('2026-10-24T09:00:00.000Z'),
      reason: 'health_timeout',
    })
    expect(parseSwitchReport({ outcome: 'switched' })).toBeUndefined()
  })
})
