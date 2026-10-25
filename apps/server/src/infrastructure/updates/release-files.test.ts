import { describe, expect, test } from 'bun:test'

import {
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
