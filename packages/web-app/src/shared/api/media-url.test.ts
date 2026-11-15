import { expect, test } from 'bun:test'

import { resolveMediaUrl, resolveServerUrl } from './media-url.ts'

test('leaves a path as it is in the browser', () => {
  const resolve = resolveMediaUrl({ serverOrigin: '' })
  expect(resolve('/api/v1/images/abc?w=320')).toBe('/api/v1/images/abc?w=320')
})

test('resolves a path against the server and adds the key', () => {
  const resolve = resolveMediaUrl({ serverOrigin: 'http://nas.local:8080', mediaKey: 's1.mac' })
  expect(resolve('/api/v1/images/abc')).toBe('http://nas.local:8080/api/v1/images/abc?key=s1.mac')
})

test('joins the key to an existing query', () => {
  const resolve = resolveMediaUrl({ serverOrigin: 'http://nas.local:8080', mediaKey: 's1.mac' })
  expect(resolve('/api/v1/images/abc?w=320')).toBe(
    'http://nas.local:8080/api/v1/images/abc?w=320&key=s1.mac',
  )
  expect(resolve('/api/v1/trickplay/x/sheet?n=2&')).toBe(
    'http://nas.local:8080/api/v1/trickplay/x/sheet?n=2&key=s1.mac',
  )
})

test('keeps a fragment after the key', () => {
  const resolve = resolveMediaUrl({ serverOrigin: 'http://nas.local:8080', mediaKey: 'k' })
  expect(resolve('/api/v1/previews/a.mp4#t=5')).toBe(
    'http://nas.local:8080/api/v1/previews/a.mp4?key=k#t=5',
  )
})

test('encodes the key', () => {
  const resolve = resolveMediaUrl({ serverOrigin: '', mediaKey: 'a+b/c=' })
  expect(resolve('/api/v1/images/x')).toBe('/api/v1/images/x?key=a%2Bb%2Fc%3D')
})

test('passes absolute, protocol-relative, data and blob URLs unchanged', () => {
  const resolve = resolveMediaUrl({ serverOrigin: 'http://nas.local:8080', mediaKey: 'k' })
  for (const url of [
    'https://image.tmdb.org/t/p/w500/a.jpg',
    '//cdn.example.com/a.jpg',
    'data:image/png;base64,AAAA',
    'blob:http://tauri.localhost/1234',
  ])
    expect(resolve(url)).toBe(url)
})

test('resolves a server path for an engine, any other URL as it is', () => {
  expect(resolveServerUrl('')('/api/v1/stream/s/x/index.m3u8')).toBe(
    '/api/v1/stream/s/x/index.m3u8',
  )
  expect(resolveServerUrl('http://nas.local:8080')('/api/v1/stream/s/x/direct')).toBe(
    'http://nas.local:8080/api/v1/stream/s/x/direct',
  )
  expect(resolveServerUrl('http://nas.local:8080')('https://cdn.example.com/a')).toBe(
    'https://cdn.example.com/a',
  )
})
