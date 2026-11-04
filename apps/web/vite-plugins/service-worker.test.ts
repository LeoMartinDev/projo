import { expect, test } from 'bun:test'

import { cacheNameOf, precacheEntries } from './service-worker.ts'

test('precaches the build output except source maps and the worker itself', () => {
  expect(
    precacheEntries([
      'index.html',
      'assets/index-abc.js',
      'assets/index-abc.js.map',
      'assets/Geist-xyz.woff2',
      'sw.js',
    ]),
  ).toEqual(['/assets/Geist-xyz.woff2', '/assets/index-abc.js', '/index.html'])
})

test('names the cache after the version and the exact build content', () => {
  const files = [
    { name: 'index.html', source: '<script src="/assets/index-abc.js"></script>' },
    { name: 'assets/index-abc.js', source: 'console.log(1)' },
  ]
  const name = cacheNameOf({ version: '1.7.0', files })
  expect(name).toMatch(/^projo-1\.7\.0-[0-9a-f]{12}$/)
  expect(cacheNameOf({ version: '1.7.0', files: files.toReversed() })).toBe(name)
  expect(
    cacheNameOf({
      version: '1.7.0',
      files: [files[0]!, { name: 'assets/index-abc.js', source: 'console.log(2)' }],
    }),
  ).not.toBe(name)
})
