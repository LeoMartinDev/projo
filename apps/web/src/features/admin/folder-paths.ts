const parts = (path: string) => path.split('/').filter((part) => part.length > 0)

export const basename = (path: string) => parts(path).pop() ?? ''

export const parentOf = (path: string) => {
  const segments = parts(path)
  return segments.length <= 1 ? '/' : `/${segments.slice(0, -1).join('/')}`
}

/** Library name suggested by its first folder: `/media/films` → `Films`. */
export const nameFromFolder = (path: string, locale: string) => {
  const base = basename(path)
  return base.charAt(0).toLocaleUpperCase(locale) + base.slice(1)
}
