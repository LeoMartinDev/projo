import { describe, expect, test } from 'bun:test'

import { compareSemVer, parseSemVer, type SemVer } from './semver.ts'

const version = (input: string): SemVer => {
  const parsed = parseSemVer(input)
  if (parsed === undefined) throw new Error(`not semver: ${input}`)
  return parsed
}

describe('parseSemVer', () => {
  test('reads major, minor, patch and prerelease', () => {
    expect(parseSemVer('1.4.0')).toEqual({ major: 1, minor: 4, patch: 0, prerelease: [] })
    expect(parseSemVer(' v2.0.1-beta.3+build.7 ')).toEqual({
      major: 2,
      minor: 0,
      patch: 1,
      prerelease: ['beta', '3'],
    })
  })

  test('refuses what is not semver', () => {
    for (const input of ['', 'dev', '1.4', '1.4.0.1', '01.4.0', '1.4.x', '1.4.0-', '1.4.0-a..b'])
      expect(parseSemVer(input)).toBeUndefined()
  })
})

describe('compareSemVer', () => {
  test('orders by major, then minor, then patch', () => {
    expect(compareSemVer(version('1.4.0'), version('1.4.0'))).toBe(0)
    expect(compareSemVer(version('1.3.9'), version('1.4.0'))).toBe(-1)
    expect(compareSemVer(version('1.10.0'), version('1.9.0'))).toBe(1)
    expect(compareSemVer(version('2.0.0'), version('1.99.99'))).toBe(1)
    expect(compareSemVer(version('1.4.1'), version('1.4.0'))).toBe(1)
  })

  test('a prerelease comes before its release', () => {
    expect(compareSemVer(version('1.4.0-rc.1'), version('1.4.0'))).toBe(-1)
    expect(compareSemVer(version('1.4.0'), version('1.4.0-rc.1'))).toBe(1)
  })

  test('orders prereleases by identifier (semver.org §11)', () => {
    const ordered = [
      '1.0.0-alpha',
      '1.0.0-alpha.1',
      '1.0.0-alpha.beta',
      '1.0.0-beta',
      '1.0.0-beta.2',
      '1.0.0-beta.11',
      '1.0.0-rc.1',
      '1.0.0',
    ]
    for (let index = 1; index < ordered.length; index++)
      expect(compareSemVer(version(ordered[index - 1] ?? ''), version(ordered[index] ?? ''))).toBe(
        -1,
      )
  })

  test('ignores build metadata', () => {
    expect(compareSemVer(version('1.4.0+abc'), version('1.4.0+def'))).toBe(0)
  })
})
