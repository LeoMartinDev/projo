import { expect, test } from 'bun:test'

import { hostPathsFor } from './host-paths.ts'
import { createNodeFileSystem } from './node-file-system.ts'

const windows = hostPathsFor('win32')
const linux = hostPathsFor('linux')

test('elsewhere than Windows, a domain path is the host path', () => {
  expect(linux.virtualDirectory('/')).toBeUndefined()
  expect(linux.toHost('/media/films')).toBe('/media/films')
  expect(linux.fromHost('/media/films')).toBe('/media/films')
})

test('on Windows, the first segment is a drive or a UNC share', () => {
  expect(windows.toHost('/C')).toBe('C:\\')
  expect(windows.toHost('/z/films/Alien (1979)')).toBe('Z:\\films\\Alien (1979)')
  expect(windows.toHost('/UNC/nas/media')).toBe('\\\\nas\\media\\')
  expect(windows.toHost('/UNC/nas/media/films')).toBe('\\\\nas\\media\\films')
})

test('on Windows, /, /UNC and /UNC/<server> are virtual folders', () => {
  expect(windows.virtualDirectory('/')).toEqual({ kind: 'drives', path: '/' })
  expect(windows.virtualDirectory('/unc')).toEqual({ kind: 'unc', path: '/UNC' })
  expect(windows.virtualDirectory('/unc/nas')).toEqual({ kind: 'unc', path: '/UNC/nas' })
  expect(windows.virtualDirectory('/UNC/nas/media')).toBeUndefined()
  expect(windows.virtualDirectory('/C')).toBeUndefined()
})

test('on Windows, a path naming no drive or share has no host path', () => {
  expect(windows.toHost('/')).toBeUndefined()
  expect(windows.toHost('/mnt/nas')).toBeUndefined()
  expect(windows.toHost('/UNC/nas')).toBeUndefined()
})

test('on Windows, host paths already native are left as is', () => {
  expect(windows.toHost('C:\\projo\\.data\\cache\\x.vtt')).toBe('C:\\projo\\.data\\cache\\x.vtt')
})

test('on Windows, realpath results come back as domain paths', () => {
  expect(windows.fromHost('C:\\')).toBe('/C')
  expect(windows.fromHost('c:\\Users\\leo')).toBe('/C/Users/leo')
  expect(windows.fromHost('\\\\nas\\media\\films')).toBe('/UNC/nas/media/films')
  expect(windows.fromHost('\\\\?\\UNC\\nas\\media\\')).toBe('/UNC/nas/media')
  expect(windows.fromHost('\\\\?\\D:\\films')).toBe('/D/films')
})

test.if(process.platform === 'win32')(
  'on Windows, / lists the drives and paths round-trip',
  async () => {
    const fileSystem = createNodeFileSystem()
    const root = await fileSystem.readDirectory('/')
    expect(root.ok && root.value).toContainEqual({ name: 'C', kind: 'directory' })
    expect(await fileSystem.realPath('/')).toEqual({ ok: true, value: '/' })
    expect(await fileSystem.realPath('/unc/nas')).toEqual({ ok: true, value: '/UNC/nas' })
    expect(await fileSystem.realPath('/c/windows')).toEqual({ ok: true, value: '/C/Windows' })
    expect(await fileSystem.stat('/mnt')).toMatchObject({
      ok: false,
      error: { code: 'fs/path_not_found' },
    })
  },
)
