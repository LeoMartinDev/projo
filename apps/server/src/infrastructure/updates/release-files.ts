import { z } from 'zod'

import type { ReleaseManifest, SwitchReport } from '../../core/updates/update.ts'
import { parseSemVer } from '../../core/updates/semver.ts'

const semverString = z.string().refine((value) => parseSemVer(value) !== undefined, {
  message: 'expected a semver version',
})
const sha256HexSchema = z.string().regex(/^[0-9a-f]{64}$/u)

export const isSafeBundlePath = (path: string): boolean => {
  if (path === '' || path.startsWith('/') || path.includes('\\') || /^[A-Za-z]:/u.test(path))
    return false
  return path.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..')
}

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

export const parseSwitchReport = (raw: unknown): SwitchReport | undefined => {
  const parsed = switchReportSchema.safeParse(raw)
  if (!parsed.success) return undefined
  const { reason, at, ...rest } = parsed.data
  return { ...rest, at: new Date(at), ...(reason === undefined ? {} : { reason }) }
}
