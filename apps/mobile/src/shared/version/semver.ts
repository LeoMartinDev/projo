/** Semantic version (semver.org). Build metadata is ignored, as the spec says. */
export type SemVer = {
  readonly major: number
  readonly minor: number
  readonly patch: number
  readonly prerelease: readonly string[]
}

const semverPattern =
  /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z.-]+)?$/

export const parseSemVer = (input: string): SemVer | undefined => {
  const match = semverPattern.exec(input.trim())
  if (!match) return undefined
  const [, major, minor, patch, prerelease] = match
  return {
    major: Number(major),
    minor: Number(minor),
    patch: Number(patch),
    prerelease: prerelease === undefined ? [] : prerelease.split('.'),
  }
}

const isNumeric = (identifier: string): boolean => /^\d+$/.test(identifier)

const compareIdentifiers = (a: string, b: string): number => {
  if (isNumeric(a) && isNumeric(b)) return Math.sign(Number(a) - Number(b))
  if (isNumeric(a)) return -1
  if (isNumeric(b)) return 1
  return a < b ? -1 : a > b ? 1 : 0
}

/** A release outranks its prereleases: `1.4.0-beta.1 < 1.4.0`. */
const comparePrerelease = (a: readonly string[], b: readonly string[]): number => {
  if (a.length === 0 || b.length === 0) return Math.sign(b.length - a.length)
  for (let index = 0; index < Math.max(a.length, b.length); index++) {
    const left = a[index]
    const right = b[index]
    if (left === undefined) return -1
    if (right === undefined) return 1
    const order = compareIdentifiers(left, right)
    if (order !== 0) return order
  }
  return 0
}

/** Negative when `a < b`, 0 when equal, positive when `a > b`. */
export const compareSemVer = (a: SemVer, b: SemVer): number =>
  Math.sign(a.major - b.major) ||
  Math.sign(a.minor - b.minor) ||
  Math.sign(a.patch - b.patch) ||
  comparePrerelease(a.prerelease, b.prerelease)
