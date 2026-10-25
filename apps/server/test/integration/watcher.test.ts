import { afterAll, describe, expect, test } from 'bun:test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  createLibraryWatchers,
  WATCH_DEBOUNCE_MS,
} from '../../src/application/scanner/library-watchers.ts'
import type { DirectoryWatcher } from '../../src/core/fs/file-system.ts'
import type { Library, LibraryRepository } from '../../src/core/library/library.ts'
import type { ScanRequester } from '../../src/core/scanner/ports.ts'
import { createInMemoryDirectoryCache } from '../../src/infrastructure/scanner/in-memory-directory-cache.ts'
import { createNodeDirectoryWatcher } from '../../src/infrastructure/watch/node-directory-watcher.ts'
import { createTempDir } from '../support/database.ts'
import { silentLogger } from '../support/logger.ts'

const tmp = createTempDir('projo-watch-')
afterAll(() => tmp.cleanup())

const library = (path: string, watchEnabled = true): Library => ({
  id: 'lib',
  name: 'Lib',
  hint: 'auto',
  scanIntervalMinutes: 15,
  watchEnabled,
  quietPeriodSeconds: 120,
  detectSegments: true,
  preExtractSubtitles: false,
  trickplayEnabled: true,
  ratingCountry: 'FR',
  createdAt: new Date(),
  roots: [{ id: 'root', libraryId: 'lib', path, state: 'ok', lastFileCount: 0 }],
})

const until = async (check: () => boolean, timeoutMs = 3_000) => {
  const start = Date.now()
  while (!check()) {
    if (Date.now() - start > timeoutMs) return false
    await Bun.sleep(20)
  }
  return true
}

const setup = (libraries: Library[], watcher?: DirectoryWatcher) => {
  const requests: Parameters<ScanRequester>[0][] = []
  const requestScan: ScanRequester = (input) => {
    requests.push(input)
    return { jobId: 'job', deduplicated: false }
  }
  let current = libraries
  const libraryRepository = { list: () => current } as unknown as LibraryRepository
  const directoryCache = createInMemoryDirectoryCache()
  const watchers = createLibraryWatchers({
    watcher: watcher ?? createNodeDirectoryWatcher({ logger: silentLogger }),
    libraryRepository,
    directoryCache,
    requestScan,
    logger: silentLogger,
  })
  return { watchers, requests, directoryCache, setLibraries: (next: Library[]) => (current = next) }
}

describe('library watchers (§7.4)', () => {
  test('a new file deep in the tree asks for a debounced incremental scan', async () => {
    const root = join(tmp.path, 'recursive')
    mkdirSync(join(root, 'a/b'), { recursive: true })
    const { watchers, requests } = setup([library(root)])
    watchers.sync()
    expect([...watchers.modes().values()]).toEqual(['recursive'])
    await Bun.sleep(100)
    mkdirSync(join(root, 'a/b/New Show/Season 1'), { recursive: true })
    writeFileSync(join(root, 'a/b/New Show/Season 1/New.Show.S01E01.mkv'), 'x')
    expect(await until(() => requests.length > 0)).toBe(true)
    expect(requests[0]).toEqual({ libraryId: 'lib', kind: 'watch', delayMs: WATCH_DEBOUNCE_MS })
    watchers.stop()
  })

  test('partial downloads and hidden files are noise', async () => {
    const root = join(tmp.path, 'noise')
    mkdirSync(root, { recursive: true })
    const { watchers, requests } = setup([library(root)])
    watchers.sync()
    await Bun.sleep(100)
    writeFileSync(join(root, 'Film.mkv.!qB'), 'x')
    writeFileSync(join(root, 'Film.mkv.part'), 'x')
    writeFileSync(join(root, '.DS_Store'), 'x')
    await Bun.sleep(400)
    expect(requests).toEqual([])
    watchers.stop()
  })

  test('disabled libraries are not watched; removed ones are closed; broken watchers re-armed', () => {
    const root = join(tmp.path, 'toggle')
    mkdirSync(root, { recursive: true })
    const { watchers, setLibraries } = setup([library(root, false)])
    watchers.sync()
    expect(watchers.modes().size).toBe(0)
    setLibraries([library(root)])
    watchers.sync()
    expect(watchers.modes().size).toBe(1)
    setLibraries([])
    watchers.sync()
    expect(watchers.modes().size).toBe(0)
    watchers.stop()
  })

  test('falls back to one watcher per known directory when recursion is refused', () => {
    const calls: { fallbackDirectories: readonly string[] }[] = []
    const fake: DirectoryWatcher = {
      watch: (input) => {
        calls.push({ fallbackDirectories: input.fallbackDirectories })
        return { ok: true, value: { mode: 'per_directory', close: () => {} } }
      },
    }
    const root = join(tmp.path, 'fallback')
    const { watchers, directoryCache } = setup([library(root)], fake)
    const entry = { mtimeMs: 1, cachedAt: 0, directories: [], files: [], entryCount: 0 }
    directoryCache.set('root', '', entry)
    directoryCache.set('root', 'Films', entry)
    watchers.sync()
    watchers.sync()
    expect(calls).toEqual([{ fallbackDirectories: ['Films'] }])
    directoryCache.set('root', 'Séries', entry)
    watchers.sync()
    expect(calls.at(-1)).toEqual({ fallbackDirectories: ['Films', 'Séries'] })
  })
})
