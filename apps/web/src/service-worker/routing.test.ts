import { expect, test } from 'bun:test'

import { routeRequest } from './routing.ts'

const origin = 'https://projo.example'
const precached = new Set(['/index.html', '/assets/index-abc.js', '/assets/index-def.css'])
const route = (path: string, init: { method?: string; mode?: string; origin?: string } = {}) =>
  routeRequest({
    method: init.method ?? 'GET',
    mode: init.mode ?? 'cors',
    url: new URL(path, init.origin ?? origin),
    origin,
    precached,
  })

test('serves every app navigation from the cached shell', () => {
  expect(route('/', { mode: 'navigate' })).toBe('shell')
  expect(route('/items/42?from=start', { mode: 'navigate' })).toBe('shell')
  expect(route('/oauth/authorize?client_id=x', { mode: 'navigate' })).toBe('shell')
})

test('leaves the API, streams, health, MCP and OAuth endpoints to the network', () => {
  for (const path of [
    '/api/v1/home',
    '/api/v1/stream/s/secret/master.m3u8',
    '/health',
    '/mcp',
    '/.well-known/oauth-authorization-server',
    '/oauth/token',
  ]) {
    expect(route(path, { mode: 'navigate' })).toBe('network')
    expect(route(path)).toBe('network')
  }
})

test('answers precached build files from the cache, anything else from the network', () => {
  expect(route('/assets/index-abc.js')).toBe('precached')
  expect(route('/assets/index-def.css')).toBe('precached')
  expect(route('/assets/index-abc.js?v=2')).toBe('network')
  expect(route('/assets/gone-123.js')).toBe('network')
  expect(route('/manifest.webmanifest')).toBe('network')
  expect(route('/sw.js')).toBe('network')
})

test('never touches other methods, other origins nor file navigations', () => {
  expect(route('/assets/index-abc.js', { method: 'HEAD' })).toBe('network')
  expect(route('/', { method: 'POST', mode: 'navigate' })).toBe('network')
  expect(route('/assets/index-abc.js', { origin: 'https://cdn.example' })).toBe('network')
  expect(route('/poster.png', { mode: 'navigate' })).toBe('network')
})
