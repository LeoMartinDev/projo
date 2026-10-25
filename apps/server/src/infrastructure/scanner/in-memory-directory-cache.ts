import type { CachedDirectory, DirectoryCache } from '../../core/scanner/ports.ts'

/**
 * Directory listings kept in memory between incremental scans (§7.4). Lost on restart: the
 * startup scan then reads every directory, which is what it should do anyway.
 */
export const createInMemoryDirectoryCache = (): DirectoryCache => {
  const roots = new Map<string, Map<string, CachedDirectory>>()
  const of = (rootId: string): Map<string, CachedDirectory> => {
    const existing = roots.get(rootId)
    if (existing !== undefined) return existing
    const created = new Map<string, CachedDirectory>()
    roots.set(rootId, created)
    return created
  }
  return {
    get: (rootId, relativePath) => roots.get(rootId)?.get(relativePath),
    set: (rootId, relativePath, entry) => {
      of(rootId).set(relativePath, entry)
    },
    retain: (rootId, visited) => {
      const directories = roots.get(rootId)
      if (directories === undefined) return
      for (const path of directories.keys()) if (!visited.has(path)) directories.delete(path)
    },
    directoriesOf: (rootId) => [...(roots.get(rootId)?.keys() ?? [])].filter((path) => path !== ''),
    forget: (rootId) => {
      roots.delete(rootId)
    },
  }
}
