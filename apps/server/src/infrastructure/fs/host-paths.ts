export type HostPaths = {
  virtualDirectory: (path: string) => VirtualDirectory | undefined
  toHost: (path: string) => string | undefined
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
    if (!path.startsWith('/')) return path
    const [first, ...rest] = segmentsOf(path)
    if (first === undefined) return undefined
    if (DRIVE.test(first)) return `${first.toUpperCase()}:\\${rest.join('\\')}`
    if (!isUnc(first) || rest.length < 2) return undefined
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

export const toHostPath = (path: string): string => hostPaths.toHost(path) ?? path
