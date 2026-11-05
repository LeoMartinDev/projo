export type SemVer = {
  major: number
  minor: number
  patch: number
  prerelease: readonly string[]
}

const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/

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

export const isSemVer = (input: string): boolean => parseSemVer(input) !== undefined

const compareIdentifiers = (a: string, b: string): number => {
  const aNum = /^\d+$/.test(a)
  const bNum = /^\d+$/.test(b)
  if (aNum && bNum) return Math.sign(Number(a) - Number(b))
  if (aNum) return -1
  if (bNum) return 1
  return a < b ? -1 : a > b ? 1 : 0
}

const comparePrerelease = (a: readonly string[], b: readonly string[]): number => {
  if (a.length === 0 && b.length === 0) return 0
  if (a.length === 0) return 1
  if (b.length === 0) return -1
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const left = a[i]
    const right = b[i]
    if (left === undefined) return -1
    if (right === undefined) return 1
    const diff = compareIdentifiers(left, right)
    if (diff !== 0) return diff
  }
  return 0
}

export const compareSemVer = (a: SemVer, b: SemVer): number =>
  Math.sign(a.major - b.major) ||
  Math.sign(a.minor - b.minor) ||
  Math.sign(a.patch - b.patch) ||
  comparePrerelease(a.prerelease, b.prerelease)

/** Undefined when either side is not valid semver. */
export const satisfiesMinimum = (actual: string, minimum: string): boolean | undefined => {
  const a = parseSemVer(actual)
  const m = parseSemVer(minimum)
  if (a === undefined || m === undefined) return undefined
  return compareSemVer(a, m) >= 0
}
