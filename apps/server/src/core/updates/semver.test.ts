import { describe, expect, test } from 'bun:test'

import {
  byVersionDescending,
  compareVersions,
  isNewerVersion,
  parseSemVer,
  satisfiesMinimum,
} from './semver.ts'

describe('semver', () => {
  test('parses versions and GitHub tags', () => {
    expect(parseSemVer('v1.4.0')).toEqual({ major: 1, minor: 4, patch: 0, prerelease: [] })
    expect(parseSemVer('1.4.0-rc.1+build.5')?.prerelease).toEqual(['rc', '1'])
    expect(parseSemVer('1.4')).toBeUndefined()
    expect(parseSemVer('dev')).toBeUndefined()
  })

  test('orders by precedence, prereleases before their release', () => {
    expect(compareVersions('1.10.0', '1.9.9')).toBe(1)
    expect(compareVersions('1.4.0-rc.1', '1.4.0')).toBe(-1)
    expect(compareVersions('1.4.0-rc.2', '1.4.0-rc.10')).toBe(-1)
    expect(compareVersions('1.4.0-alpha', '1.4.0-1')).toBe(1)
    expect(compareVersions('1.4.0+a', '1.4.0+b')).toBe(0)
    expect(['0.2.0', '1.0.0', '0.10.0'].sort(byVersionDescending)).toEqual([
      '1.0.0',
      '0.10.0',
      '0.2.0',
    ])
  })

  test('a non-semver side is never newer nor sufficient', () => {
    expect(isNewerVersion('1.4.0', '1.3.9')).toBe(true)
    expect(isNewerVersion('1.4.0', '1.4.0')).toBe(false)
    expect(isNewerVersion('1.4.0', 'dev')).toBe(false)
    expect(satisfiesMinimum('0.2.0', '0.2.0')).toBe(true)
    expect(satisfiesMinimum('0.1.9', '0.2.0')).toBe(false)
    expect(satisfiesMinimum('dev', '0.1.0')).toBe(false)
  })
})
