import { describe, expect, test } from 'bun:test'

import { createFocusMemory, focusKeyOf, navigationKind } from './focus-restore.ts'

describe('navigationKind', () => {
  test('a new path is forward, a lower history index is back', () => {
    const item = { pathname: '/items/a', index: 3 }
    expect(navigationKind(item, { pathname: '/watch/b', index: 4 })).toBe('forward')
    expect(navigationKind({ pathname: '/watch/b', index: 4 }, item)).toBe('back')
    // A replaced entry (the player's next episode, a redirect) keeps its index.
    expect(navigationKind(item, { pathname: '/watch/c', index: 3 })).toBe('forward')
  })

  test('the first load and a change of search only are not navigations between pages', () => {
    expect(navigationKind(undefined, { pathname: '/', index: 0 })).toBe('none')
    expect(
      navigationKind({ pathname: '/series', index: 1 }, { pathname: '/series', index: 2 }),
    ).toBe('none')
  })

  test('back to the same path is still back', () => {
    expect(
      navigationKind({ pathname: '/items/a', index: 2 }, { pathname: '/items/a', index: 1 }),
    ).toBe('back')
  })
})

describe('focus keys', () => {
  test('an explicit key wins over the href', () => {
    expect(focusKeyOf({ focusKey: 'episode:1', href: '/watch/1' })).toEqual({
      kind: 'key',
      value: 'episode:1',
    })
    expect(focusKeyOf({ href: '/items/2' })).toEqual({ kind: 'href', value: '/items/2' })
    expect(focusKeyOf({ focusKey: '', href: '' })).toBeUndefined()
  })

  test('each entry remembers the last element it was left from', () => {
    const memory = createFocusMemory(2)
    memory.remember('a', { kind: 'key', value: 'card:1' })
    memory.remember('a', { kind: 'key', value: 'card:2' })
    expect(memory.recall('a')).toEqual({ kind: 'key', value: 'card:2' })
    memory.remember('a', undefined)
    expect(memory.recall('a')).toBeUndefined()
  })

  test('only the last entries are kept', () => {
    const memory = createFocusMemory(2)
    memory.remember('a', { kind: 'href', value: '/a' })
    memory.remember('b', { kind: 'href', value: '/b' })
    memory.remember('c', { kind: 'href', value: '/c' })
    expect(memory.recall('a')).toBeUndefined()
    expect(memory.recall('b')).toEqual({ kind: 'href', value: '/b' })
    expect(memory.recall('c')).toEqual({ kind: 'href', value: '/c' })
  })
})
