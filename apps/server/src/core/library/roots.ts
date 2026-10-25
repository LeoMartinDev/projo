import { appError, type AppError, err, ok, type Result } from '@projo/shared'

/**
 * Normalizes an absolute container path: collapses `//`, drops `.` segments and the trailing
 * slash. `..` is refused rather than resolved (§20: nothing outside what was asked for).
 */
export const normalizeAbsolutePath = (raw: string): Result<string, AppError<'fs/invalid_path'>> => {
  const invalid = (reason: string) =>
    err(appError('fs/invalid_path', `invalid path: ${reason}`, { context: { path: raw } }))
  if (!raw.startsWith('/')) return invalid('not absolute')
  if (raw.includes('\0')) return invalid('contains NUL')
  const segments = raw.split('/').filter((segment) => segment !== '' && segment !== '.')
  if (segments.includes('..')) return invalid('contains ..')
  return ok(`/${segments.join('/')}`)
}

/** `true` when one path contains the other (or they are equal), segment-wise. */
export const pathsOverlap = (a: string, b: string): boolean => {
  if (a === b) return true
  const within = (inner: string, outer: string) => outer === '/' || inner.startsWith(`${outer}/`)
  return within(a, b) || within(b, a)
}

/** `child` relative to `parent` (`''` when equal), `undefined` when outside. */
export const relativeTo = (parent: string, child: string): string | undefined => {
  if (child === parent) return ''
  const prefix = parent === '/' ? '/' : `${parent}/`
  return child.startsWith(prefix) ? child.slice(prefix.length) : undefined
}

export const joinAbsolute = (base: string, relative: string): string =>
  relative === '' ? base : base === '/' ? `/${relative}` : `${base}/${relative}`

export const parentOf = (path: string): string | undefined => {
  if (path === '/') return undefined
  const index = path.lastIndexOf('/')
  return index <= 0 ? '/' : path.slice(0, index)
}
