import { describe, expect, test } from 'bun:test'
import { compareSemVer, parseSemVer, satisfiesMinimum } from './semver'

const cmp = (a: string, b: string) => {
  const left = parseSemVer(a)
  const right = parseSemVer(b)
  if (left === undefined || right === undefined) throw new Error('bad fixture')
  return compareSemVer(left, right)
}

describe('semver', () => {
  test('parses and rejects', () => {
    expect(parseSemVer('1.4.0')).toEqual({ major: 1, minor: 4, patch: 0, prerelease: [] })
    expect(parseSemVer('1.4.0-rc.1+build')).toEqual({
      major: 1,
      minor: 4,
      patch: 0,
      prerelease: ['rc', '1'],
    })
    for (const bad of ['1.4', 'v1.4.0', '01.2.3', 'latest', '', '../1.0.0'])
      expect(parseSemVer(bad)).toBeUndefined()
  })

  test('orders versions', () => {
    expect(cmp('1.10.0', '1.9.9')).toBe(1)
    expect(cmp('1.0.0', '1.0.0')).toBe(0)
    expect(cmp('1.0.0-rc.1', '1.0.0')).toBe(-1)
    expect(cmp('1.0.0-rc.2', '1.0.0-rc.10')).toBe(-1)
    expect(cmp('1.0.0-alpha', '1.0.0-1')).toBe(1)
  })

  test('checks a minimum', () => {
    expect(satisfiesMinimum('0.2.0', '0.1.0')).toBe(true)
    expect(satisfiesMinimum('0.1.0', '0.2.0')).toBe(false)
    expect(satisfiesMinimum('dev', '0.1.0')).toBeUndefined()
  })
})
