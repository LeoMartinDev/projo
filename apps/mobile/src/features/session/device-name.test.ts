import { describe, expect, test } from 'bun:test'

import { deviceNameOf } from './device-name.ts'

describe('deviceNameOf', () => {
  test('the model of a real device', () => {
    expect(deviceNameOf({ modelName: 'iPhone 15 Pro', isTablet: false, isDevice: true })).toBe(
      'iPhone 15 Pro',
    )
    expect(
      deviceNameOf({ modelName: 'iPad Air (5th generation)', isTablet: true, isDevice: true }),
    ).toBe('iPad Air (5th generation)')
  })

  test('the family for a model newer than expo-device, or none', () => {
    expect(deviceNameOf({ modelName: 'iPhone18,2', isTablet: false, isDevice: true })).toBe(
      'iPhone',
    )
    expect(deviceNameOf({ modelName: 'iPad17,9', isTablet: true, isDevice: true })).toBe('iPad')
    expect(deviceNameOf({ isTablet: false, isDevice: true })).toBe('iPhone')
    expect(deviceNameOf({ modelName: ' ', isTablet: true, isDevice: true })).toBe('iPad')
  })

  test('the family in the Simulator', () => {
    expect(deviceNameOf({ modelName: 'Simulator iOS', isTablet: false, isDevice: false })).toBe(
      'iPhone',
    )
    expect(deviceNameOf({ modelName: 'Simulator iOS', isTablet: true, isDevice: false })).toBe(
      'iPad',
    )
  })
})
