/**
 * Library paths are POSIX absolute in the domain (`/media/films`, §7.1). On Windows (native dev),
 * their first segment names a drive or a UNC share: `/Z/films` is `Z:\films`, `/UNC/nas/media/x`
 * is `\\nas\media\x`. `/` (the drives), `/UNC` and `/UNC/<server>` are virtual folders. Elsewhere
 * a domain path is the host path itself.
 */
export type HostPaths = {
  /** A folder with no host path of its own, and its canonical domain path. */
  virtualDirectory: (path: string) => VirtualDirectory | undefined
  /** Host path of a domain path; `undefined` when it names none (`/mnt` on Windows). */
  toHost: (path: string) => string | undefined
  /** Domain path of a host path (a `realpath` result). */
  fromHost: (hostPath: string) => string
}

export type VirtualDirectory = { kind: 'drives' | 'unc'; path: string }

const DRIVE = /^[a-z]$/i

const segmentsOf = (path: string) => path.split(/[\\/]/).filter((segment) => segment !== '')

const isUnc = (segment: string | undefined) => segment?.toUpperCase() === 'UNC'

const posixPaths: HostPaths = {
  virtualDirectory: () => undefined,
  toHost: (path) => path,
  fromHost: (hostPath) => hostPath,
}

const windowsPaths: HostPaths = {
  virtualDirectory: (path) => {
    const [first, server, ...rest] = segmentsOf(path)
    if (first === undefined) return { kind: 'drives', path: '/' }
    if (!isUnc(first) || rest.length > 0) return undefined
    return { kind: 'unc', path: server === undefined ? '/UNC' : `/UNC/${server}` }
  },
  toHost: (path) => {
    // Already a host path (data directory, temporary files): left as is.
    if (!path.startsWith('/')) return path
    const [first, ...rest] = segmentsOf(path)
    if (first === undefined) return undefined
    if (DRIVE.test(first)) return `${first.toUpperCase()}:\\${rest.join('\\')}`
    if (!isUnc(first) || rest.length < 2) return undefined
    // A share root needs its trailing separator.
    return `\\\\${rest.join('\\')}${rest.length === 2 ? '\\' : ''}`
  },
  fromHost: (hostPath) => {
    const plain = hostPath.replace(/^\\\\\?\\UNC\\/i, '\\\\').replace(/^\\\\\?\\/, '')
    if (plain.startsWith('\\\\')) return `/${['UNC', ...segmentsOf(plain)].join('/')}`
    const drive = /^([a-z]):(.*)$/i.exec(plain) ?? undefined
    if (drive === undefined) return hostPath
    return `/${[(drive[1] ?? '').toUpperCase(), ...segmentsOf(drive[2] ?? '')].join('/')}`
  },
}

export const hostPathsFor = (platform: NodeJS.Platform): HostPaths =>
  platform === 'win32' ? windowsPaths : posixPaths

export const hostPaths = hostPathsFor(process.platform)

/** Host path for a file handed to the OS or to ffmpeg; a path that names none is left as is. */
export const toHostPath = (path: string): string => hostPaths.toHost(path) ?? path
