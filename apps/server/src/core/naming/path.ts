export const splitPath = (relativePath: string): readonly string[] =>
  relativePath.split('/').filter((segment) => segment !== '' && segment !== '.')

export const joinPath = (segments: readonly string[]): string => segments.join('/')

export const fileName = (relativePath: string): string => splitPath(relativePath).at(-1) ?? ''

export const parentSegments = (relativePath: string): readonly string[] =>
  splitPath(relativePath).slice(0, -1)

export const directoryOf = (relativePath: string): string => joinPath(parentSegments(relativePath))

/** Lowercased extension without the dot, `''` when none (a leading dot does not start an extension). */
export const extensionOf = (name: string): string => {
  const dot = name.lastIndexOf('.')
  return dot <= 0 ? '' : name.slice(dot + 1).toLowerCase()
}

export const stemOf = (name: string): string => {
  const dot = name.lastIndexOf('.')
  return dot <= 0 ? name : name.slice(0, dot)
}
