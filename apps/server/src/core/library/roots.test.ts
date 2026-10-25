import { describe, expect, test } from 'bun:test'

import { joinAbsolute, normalizeAbsolutePath, parentOf, pathsOverlap, relativeTo } from './roots.ts'

describe('root paths', () => {
  test('normalizes absolute paths and refuses the rest', () => {
    expect(normalizeAbsolutePath('/media//films/./')).toEqual({ ok: true, value: '/media/films' })
    expect(normalizeAbsolutePath('/')).toEqual({ ok: true, value: '/' })
    for (const bad of ['media', '', '/a/../b', '/a/\0b', '..']) {
      expect(normalizeAbsolutePath(bad)).toMatchObject({
        ok: false,
        error: { code: 'fs/invalid_path' },
      })
    }
  })

  test('overlap is segment-wise', () => {
    expect(pathsOverlap('/media', '/media/films')).toBe(true)
    expect(pathsOverlap('/media/films', '/media')).toBe(true)
    expect(pathsOverlap('/media', '/media')).toBe(true)
    expect(pathsOverlap('/', '/media')).toBe(true)
    expect(pathsOverlap('/media/films', '/media/films2')).toBe(false)
  })

  test('relative, join, parent', () => {
    expect(relativeTo('/a', '/a/b/c')).toBe('b/c')
    expect(relativeTo('/a', '/a')).toBe('')
    expect(relativeTo('/a', '/ab')).toBeUndefined()
    expect(relativeTo('/', '/x')).toBe('x')
    expect(joinAbsolute('/', 'x')).toBe('/x')
    expect(joinAbsolute('/a', '')).toBe('/a')
    expect(parentOf('/a/b')).toBe('/a')
    expect(parentOf('/a')).toBe('/')
    expect(parentOf('/')).toBeUndefined()
  })
})
