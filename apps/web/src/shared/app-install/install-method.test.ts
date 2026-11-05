import { describe, expect, test } from 'bun:test'

import { installMethodOf, isIos } from './install-method.ts'

const iphoneSafari =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 26_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.1 Mobile/15E148 Safari/604.1'
const iphoneChrome =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 26_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/142.0.0.0 Mobile/15E148 Safari/604.1'
const ipadDesktopMode =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.1 Safari/605.1.15'
const androidChrome =
  'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Mobile Safari/537.36'

describe('isIos', () => {
  test('recognises iPhone browsers, Safari or not', () => {
    expect(isIos({ userAgent: iphoneSafari, maxTouchPoints: 5 })).toBe(true)
    expect(isIos({ userAgent: iphoneChrome, maxTouchPoints: 5 })).toBe(true)
  })

  test('tells an iPad asking for the desktop site from a Mac by touch', () => {
    expect(isIos({ userAgent: ipadDesktopMode, maxTouchPoints: 5 })).toBe(true)
    expect(isIos({ userAgent: ipadDesktopMode, maxTouchPoints: 0 })).toBe(false)
  })

  test('leaves Android out', () => {
    expect(isIos({ userAgent: androidChrome, maxTouchPoints: 5 })).toBe(false)
  })
})

describe('installMethodOf', () => {
  const phone = {
    device: 'phone',
    installed: false,
    canPrompt: false,
    maxTouchPoints: 5,
  } as const

  test('uses the browser dialog when it offered one', () => {
    expect(installMethodOf({ ...phone, userAgent: androidChrome, canPrompt: true })).toBe('prompt')
  })

  test('explains the share menu on iOS', () => {
    expect(installMethodOf({ ...phone, userAgent: iphoneSafari })).toBe('ios')
    expect(installMethodOf({ ...phone, device: 'tablet', userAgent: ipadDesktopMode })).toBe('ios')
  })

  test('offers nothing once installed, on a desktop, or without a way to install', () => {
    expect(installMethodOf({ ...phone, userAgent: iphoneSafari, installed: true })).toBeUndefined()
    expect(
      installMethodOf({ ...phone, userAgent: androidChrome, canPrompt: true, installed: true }),
    ).toBeUndefined()
    expect(
      installMethodOf({ ...phone, device: 'desktop', userAgent: androidChrome, canPrompt: true }),
    ).toBeUndefined()
    expect(installMethodOf({ ...phone, userAgent: androidChrome })).toBeUndefined()
  })
})
