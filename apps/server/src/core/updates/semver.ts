/**
 * Semantic versions (semver.org §11 precedence), for the updater (§16.4): is a release newer than
 * the running version, does the runtime satisfy a `runtimeMin`. Build metadata is ignored.
 */

export type SemVer = {
  major: number
  minor: number
  patch: number
  prerelease: readonly string[]
}

const SEMVER =
  /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/u

/** Accepts an optional leading `v` (GitHub tags); `undefined` when not semver. */
export const parseSemVer = (input: string): SemVer | undefined => {
  const match = SEMVER.exec(input.trim())
  if (!match) return undefined
  const [, major, minor, patch, prerelease] = match
  return {
    major: Number(major),
    minor: Number(minor),
    patch: Number(patch),
    prerelease: prerelease === undefined ? [] : prerelease.split('.'),
  }
}

const compareIdentifiers = (a: string, b: string): number => {
  const aNumeric = /^\d+$/u.test(a)
  const bNumeric = /^\d+$/u.test(b)
  if (aNumeric && bNumeric) return Math.sign(Number(a) - Number(b))
  if (aNumeric) return -1
  if (bNumeric) return 1
  return a < b ? -1 : a > b ? 1 : 0
}

const comparePrerelease = (a: readonly string[], b: readonly string[]): number => {
  if (a.length === 0 || b.length === 0) return Math.sign(b.length - a.length)
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const left = a[index]
    const right = b[index]
    if (left === undefined) return -1
    if (right === undefined) return 1
    const diff = compareIdentifiers(left, right)
    if (diff !== 0) return diff
  }
  return 0
}

const compareParsed = (a: SemVer, b: SemVer): number =>
  Math.sign(a.major - b.major) ||
  Math.sign(a.minor - b.minor) ||
  Math.sign(a.patch - b.patch) ||
  comparePrerelease(a.prerelease, b.prerelease)

/** −1, 0 or 1; `undefined` when either side is not semver. */
export const compareVersions = (a: string, b: string): number | undefined => {
  const left = parseSemVer(a)
  const right = parseSemVer(b)
  return left === undefined || right === undefined ? undefined : compareParsed(left, right)
}

/** `candidate` > `current`; `false` when either is not semver (a dev build is never "older"). */
export const isNewerVersion = (candidate: string, current: string): boolean =>
  (compareVersions(candidate, current) ?? 0) > 0

/** `actual` ≥ `minimum`; `false` when either is not semver (`dev` runtime). */
export const satisfiesMinimum = (actual: string, minimum: string): boolean =>
  (compareVersions(actual, minimum) ?? -1) >= 0

/** Newest first; non-semver strings last. */
export const byVersionDescending = (a: string, b: string): number =>
  compareVersions(b, a) ?? (parseSemVer(a) === undefined ? 1 : -1)
