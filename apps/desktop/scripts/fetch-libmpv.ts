// Fetches the libmpv the desktop app is built with: `libmpv-2.dll` from a pinned
// zhongfly/mpv-winbuild release (`mpv-dev-lgpl-x86_64-…`, LGPL build, linked dynamically) into
// src-tauri/lib/ (gitignored), where the build bundles it and debug builds load it.
//
//   bun run --cwd apps/desktop fetch-libmpv
//
// Both the archive and the extracted DLL are checked against pinned SHA-256s. Windows only
// (extraction by the system's bsdtar, C:\Windows\System32\tar.exe, which reads 7z).
// To move to a newer mpv: pick a release at least a week old
// (`gh api repos/zhongfly/mpv-winbuild/releases`), update the constants below (the archive digest
// is the asset's `digest` field), run the script once with PROJO_LIBMPV_PRINT_DLL_SHA=1 to print
// the DLL digest, pin it, then check playback (PRODUCT.md §28).
import { copyFile, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const release = '2026-11-05-3138fc8eea'
const asset = 'mpv-dev-lgpl-x86_64-20261105-git-3138fc8eea.7z'
const archiveSha256 = '619412d7c73c583e189982ed32cf853b951e7672cef0cbd7151d02088d792469'
const dllSha256 = '173331d5da96c948c9aaf8860b1b8083d2b1991529dc56842da561ecb0593930'
const dllName = 'libmpv-2.dll'

const url = `https://github.com/zhongfly/mpv-winbuild/releases/download/${release}/${asset}`
const target = join(import.meta.dir, '..', 'src-tauri', 'lib', dllName)
const printDllSha = process.env['PROJO_LIBMPV_PRINT_DLL_SHA'] === '1'

const sha256 = async (path: string) =>
  new Bun.CryptoHasher('sha256').update(await Bun.file(path).arrayBuffer()).digest('hex')

const fail = (message: string): never => {
  console.error(`fetch-libmpv: ${message}`)
  process.exit(1)
}

if (process.platform !== 'win32') fail('Windows only for now (PRODUCT.md §28)')

if ((await Bun.file(target).exists()) && (await sha256(target)) === dllSha256) {
  console.log(`${dllName} is already the pinned build (${release})`)
  process.exit(0)
}

const work = await mkdtemp(join(tmpdir(), 'projo-libmpv-'))
const cleanup = () => rm(work, { recursive: true, force: true })
const archive = join(work, asset)

console.log(`downloading ${url}`)
const response = await fetch(url)
if (!response.ok) fail(`download failed: HTTP ${response.status}`)
await Bun.write(archive, response)

const archiveDigest = await sha256(archive)
if (archiveDigest !== archiveSha256) {
  await cleanup()
  fail(`archive SHA-256 mismatch: expected ${archiveSha256}, got ${archiveDigest}`)
}

const tar = join(process.env['SystemRoot'] ?? 'C:\\Windows', 'System32', 'tar.exe')
const extracted = Bun.spawnSync([tar, '-xf', archive, '-C', work, dllName], { stderr: 'pipe' })
if (extracted.exitCode !== 0) {
  await cleanup()
  fail(`extraction failed: ${extracted.stderr.toString().trim()}`)
}

const dll = join(work, dllName)
const dllDigest = await sha256(dll)
if (printDllSha) console.log(`${dllName} SHA-256: ${dllDigest}`)
else if (dllDigest !== dllSha256) {
  await cleanup()
  fail(`${dllName} SHA-256 mismatch: expected ${dllSha256}, got ${dllDigest}`)
}

await mkdir(join(target, '..'), { recursive: true })
await copyFile(dll, target)
await cleanup()
console.log(`${dllName} (${release}) → ${target}`)
