import { statSync } from 'node:fs'
import { join, normalize, sep } from 'node:path'

import type { StaticFiles } from '../../core/http/static-files.ts'

const isFile = (path: string): boolean => {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}

export const createStaticFiles = ({ root }: { root: string }): StaticFiles => {
  const base = normalize(root)
  return {
    resolve: (pathname) => {
      let decoded: string
      try {
        decoded = decodeURIComponent(pathname)
      } catch {
        return undefined
      }
      if (decoded.includes('\0')) return undefined
      const path = normalize(join(base, decoded))
      if (!path.startsWith(base.endsWith(sep) ? base : `${base}${sep}`)) return undefined
      return isFile(path) ? { path, file: Bun.file(path) } : undefined
    },
  }
}
