import { z } from 'zod'

import type { ReleaseManifest, SwitchReport } from '../../core/updates/update.ts'
import { parseSemVer } from '../../core/updates/semver.ts'

/**
 * Files of a release (§16.2) and of the switch (§16.3), validated at the boundary: the bundle's
 * `manifest.json`, `SHA256SUMS`, the supervisor's `switch-result.json`.
 */

const semverString = z.string().refine((value) => parseSemVer(value) !== undefined, {
  message: 'expected a semver version',
})
const sha256HexSchema = z.string().regex(/^[0-9a-f]{64}$/u)

/**
 * A POSIX path relative to the bundle that stays inside it: no absolute path, drive letter,
 * backslash, `.` or `..` segment (§20: an archive never writes outside `versions/<v>`).
 */
export const isSafeBundlePath = (path: string): boolean => {
  if (path === '' || path.startsWith('/') || path.includes('\\') || /^[A-Za-z]:/u.test(path))
    return false
  return path.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..')
}

/**
 * §20: a release file URL lies under the download prefix once parsed (`new URL` resolves `..`
 * and `%2e%2e`, so a string prefix is not enough). Encoded `/` or `\` are refused: a server
 * decoding them could step out of the prefix.
 */
export const isReleaseDownloadUrl = (url: string, prefix: string): boolean => {
  if (!URL.canParse(url)) return false
  const target = new URL(url)
  const allowed = new URL(prefix)
  return (
    target.origin === allowed.origin &&
    target.pathname.startsWith(allowed.pathname.replace(/\/?$/u, '/')) &&
    !/%(2f|5c)/iu.test(target.pathname)
  )
}

export const MANIFEST_ENTRY_FILE = 'server.js'

const manifestSchema = z.object({
  version: semverString,
  runtimeMin: semverString,
  builtAt: z.iso.datetime({ offset: true }),
  files: z.record(z.string(), sha256HexSchema),
})

/** `manifest.json` (runtime/README.md): every path safe, `server.js` listed, not itself. */
export const parseReleaseManifest = (
  raw: unknown,
): { ok: true; manifest: ReleaseManifest } | { ok: false; reason: string } => {
  const parsed = manifestSchema.safeParse(raw)
  if (!parsed.success) return { ok: false, reason: parsed.error.message }
  const { files } = parsed.data
  const unsafe = Object.keys(files).find((path) => !isSafeBundlePath(path))
  if (unsafe !== undefined) return { ok: false, reason: `unsafe path ${unsafe}` }
  if ('manifest.json' in files) return { ok: false, reason: 'manifest.json lists itself' }
  if (!(MANIFEST_ENTRY_FILE in files))
    return { ok: false, reason: `${MANIFEST_ENTRY_FILE} is not listed` }
  return {
    ok: true,
    manifest: { ...parsed.data, builtAt: new Date(parsed.data.builtAt) },
  }
}

/**
 * `SHA256SUMS` (`sha256sum` output): `<hex>  <name>` or `<hex> *<name>` per line. Unparseable
 * lines are ignored; the caller requires the names it needs.
 */
export const parseChecksums = (text: string): Map<string, string> => {
  const sums = new Map<string, string>()
  for (const line of text.split(/\r?\n/u)) {
    const match = /^([0-9a-fA-F]{64}) [ *](.+)$/u.exec(line.trim())
    if (!match) continue
    const [, hash, name] = match
    if (hash !== undefined && name !== undefined) sums.set(name.trim(), hash.toLowerCase())
  }
  return sums
}

export const sha256Hex = (data: Uint8Array | string): string => {
  const hasher = new Bun.CryptoHasher('sha256')
  hasher.update(data)
  return hasher.digest('hex')
}

const switchReportSchema = z.object({
  fromVersion: semverString,
  toVersion: semverString,
  outcome: z.enum(['switched', 'rolled_back']),
  at: z.iso.datetime({ offset: true }),
  reason: z.string().optional(),
})

/** The supervisor's `switch-result.json` (runtime/README.md "Contrat de bascule"). */
export const parseSwitchReport = (raw: unknown): SwitchReport | undefined => {
  const parsed = switchReportSchema.safeParse(raw)
  if (!parsed.success) return undefined
  const { reason, at, ...rest } = parsed.data
  return { ...rest, at: new Date(at), ...(reason === undefined ? {} : { reason }) }
}
