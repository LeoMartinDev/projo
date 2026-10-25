import { describe, expect, test } from 'bun:test'

import { moveProvider, providerRows, setProviderEnabled } from './providers.ts'

describe('providerRows', () => {
  test('the enabled ones in their order, then the disabled ones', () => {
    expect(providerRows(['skipdb', 'theintrodb'])).toEqual([
      { id: 'skipdb', enabled: true },
      { id: 'theintrodb', enabled: true },
      { id: 'introdb', enabled: false },
    ])
    expect(providerRows([]).every((row) => !row.enabled)).toBe(true)
  })
})

describe('setProviderEnabled', () => {
  test('a provider turned on is asked last', () => {
    expect(setProviderEnabled(['skipdb'], 'theintrodb', true)).toEqual(['skipdb', 'theintrodb'])
  })

  test('a provider turned off leaves the list, the others keep their order', () => {
    expect(setProviderEnabled(['theintrodb', 'introdb', 'skipdb'], 'introdb', false)).toEqual([
      'theintrodb',
      'skipdb',
    ])
  })

  test('never twice', () => {
    expect(setProviderEnabled(['introdb'], 'introdb', true)).toEqual(['introdb'])
  })
})

describe('moveProvider', () => {
  const order = ['theintrodb', 'introdb', 'skipdb'] as const

  test('one step earlier or later', () => {
    expect(moveProvider(order, 'skipdb', -1)).toEqual(['theintrodb', 'skipdb', 'introdb'])
    expect(moveProvider(order, 'theintrodb', 1)).toEqual(['introdb', 'theintrodb', 'skipdb'])
  })

  test('unchanged at an end or for a disabled provider', () => {
    expect(moveProvider(order, 'theintrodb', -1)).toEqual([...order])
    expect(moveProvider(order, 'skipdb', 1)).toEqual([...order])
    expect(moveProvider(['introdb'], 'skipdb', -1)).toEqual(['introdb'])
  })
})
