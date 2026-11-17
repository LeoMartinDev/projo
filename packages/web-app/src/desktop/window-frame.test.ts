import { describe, expect, test } from 'bun:test'

import { startsWindowDrag, windowFrameOf } from './window-frame.ts'

/** An element whose ancestors (itself included) match the given selectors. */
const element = (...matches: string[]) => ({
  closest: (selector: string) =>
    matches.some((match) => selector.split(', ').includes(match)) ? {} : undefined,
})

describe('windowFrameOf', () => {
  test('macOS keeps the system buttons, Windows draws its own', () => {
    expect(
      windowFrameOf(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)',
      ),
    ).toBe('system')
    expect(
      windowFrameOf(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36 Edg/142.0.0.0',
      ),
    ).toBe('drawn')
  })
})

describe('startsWindowDrag', () => {
  test('the top strip and the regions marked as title bar move the window', () => {
    expect(startsWindowDrag(element(), 10)).toBe(true)
    expect(startsWindowDrag(element('[data-window-drag]'), 60)).toBe(true)
  })

  test('the rest of the page does not', () => {
    expect(startsWindowDrag(element(), 32)).toBe(false)
    expect(startsWindowDrag(element(), 400)).toBe(false)
  })

  test('controls keep the pointer, in the strip too', () => {
    for (const control of ['button', 'a', 'input', '[role="slider"]', 'dialog']) {
      expect(startsWindowDrag(element(control), 10)).toBe(false)
      expect(startsWindowDrag(element(control, '[data-window-drag]'), 60)).toBe(false)
    }
  })
})
