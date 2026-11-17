/**
 * §7.5 "Many files missing at once": a scan that turns many files missing in one pass usually means
 * a disk or a share below a root went away (mergerfs, Unraid, one mount per disk), which the root
 * guard cannot see. The files still turn missing; the admin is told, with the folder they shared.
 */
export const MANY_MISSING_MIN_FILES = 20
export const MANY_MISSING_MIN_SHARE = 0.1

export type MissingFile = { rootId: string; relativePath: string }

export type ManyMissing = { count: number; rootId: string; folder: string }

/** True when `missing` files reach both thresholds out of the library's `tracked` files. */
export const isManyMissing = ({ missing, tracked }: { missing: number; tracked: number }) =>
  missing >= MANY_MISSING_MIN_FILES && missing >= tracked * MANY_MISSING_MIN_SHARE

/** Deepest folder holding every path, relative to their root ('' when only the root does). */
export const commonFolder = (relativePaths: readonly string[]): string => {
  const [first, ...rest] = relativePaths.map((path) => path.split('/').slice(0, -1))
  if (first === undefined) return ''
  let length = first.length
  for (const segments of rest) {
    let same = 0
    while (same < length && segments[same] === first[same]) same += 1
    length = same
  }
  return first.slice(0, length).join('/')
}

/**
 * The files a scan just turned missing, out of the library's `tracked` files (every file but the
 * hidden ones, the newly missing included): undefined below the thresholds, otherwise their count
 * and the folder shared by those of the root that lost the most.
 */
export const assessManyMissing = ({
  newlyMissing,
  tracked,
}: {
  newlyMissing: readonly MissingFile[]
  tracked: number
}): ManyMissing | undefined => {
  if (!isManyMissing({ missing: newlyMissing.length, tracked })) return undefined
  const byRoot = new Map<string, string[]>()
  for (const file of newlyMissing) {
    byRoot.set(file.rootId, [...(byRoot.get(file.rootId) ?? []), file.relativePath])
  }
  const [rootId, paths] = [...byRoot].reduce((most, entry) =>
    entry[1].length > most[1].length ? entry : most,
  )
  return { count: newlyMissing.length, rootId, folder: commonFolder(paths) }
}
