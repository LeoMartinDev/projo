// Fetches the libmpv the desktop app is built with, an LGPL build linked dynamically (PRODUCT.md
// §28.5, §28.11), into src-tauri/lib/ (gitignored), where the build bundles it and debug builds
// load it:
// - Windows: `libmpv-2.dll` from a pinned zhongfly/mpv-winbuild release (`mpv-dev-lgpl-x86_64-…`),
//   extracted by the system's bsdtar (C:\Windows\System32\tar.exe, which reads 7z);
// - macOS (Apple silicon): `libmpv.dylib` and its 17 dependencies from a pinned
//   media-kit/libmpv-darwin-build release (`macos-arm64-video-full`: mpv built with `-Dgpl=false`,
//   FFmpeg's LGPL decoders, TrueHD included), into src-tauri/lib/macos/.
//
//   bun run --cwd apps/desktop fetch-libmpv
//
// The archive and every extracted library are checked against pinned SHA-256s. To move to a newer
// build: pick a release at least a week old, update the constants below (the archive digest is
// the asset's `digest` field), run the script once with PROJO_LIBMPV_PRINT_SHA=1 to print the
// libraries' digests, pin them, then check playback (PRODUCT.md §28.8).
import { copyFile, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

type Build = {
  url: string
  archiveSha256: string
  /** Where the archive's libraries are, relative to the extraction directory. */
  root: string
  /** Each library kept, by name, with its SHA-256. */
  libraries: Record<string, string>
  extract: (archive: string, into: string) => string[]
  target: string
}

const lib = join(import.meta.dir, '..', 'src-tauri', 'lib')

const windows = (): Build => {
  const release = '2026-11-05-3138fc8eea'
  const asset = 'mpv-dev-lgpl-x86_64-20261105-git-3138fc8eea.7z'
  return {
    url: `https://github.com/zhongfly/mpv-winbuild/releases/download/${release}/${asset}`,
    archiveSha256: '619412d7c73c583e189982ed32cf853b951e7672cef0cbd7151d02088d792469',
    root: '',
    libraries: {
      'libmpv-2.dll': '173331d5da96c948c9aaf8860b1b8083d2b1991529dc56842da561ecb0593930',
    },
    extract: (archive, into) => [
      join(process.env['SystemRoot'] ?? 'C:\\Windows', 'System32', 'tar.exe'),
      '-xf',
      archive,
      '-C',
      into,
      'libmpv-2.dll',
    ],
    target: lib,
  }
}

const macos = (): Build => {
  const release = 'v0.7.3'
  const name = `libmpv-libs_${release}_macos-arm64-video-full`
  return {
    url: `https://github.com/media-kit/libmpv-darwin-build/releases/download/${release}/${name}.tar.gz`,
    archiveSha256: '9bb168ec908b4801f4231f411e3278a0aea644a2b03ce375c880d2813ab7f949',
    root: name,
    libraries: {
      'libass.dylib': '84ca72ff192a8a922e0e6c076aeed2b471a1027655b2d21bfef2b41615c0e4e1',
      'libavcodec.dylib': 'aa6f2acae27f3d3c80a19bd3a3d7f1df11dd15f847bb6ef1a28a56cf1e23da75',
      'libavfilter.dylib': '376df27a4cb3b3494bad5517f79dac596ecacfbee4bdae1284fd4238d12df4c1',
      'libavformat.dylib': '0a0481c30d7248f280ea829c61885436b6d0494e5c8d1b55526af7ec59e8ef19',
      'libavutil.dylib': '7c7207d440f50f9a0c479c664ec185d1d9daec2b4ce4f68f88da449a2faec943',
      'libdav1d.dylib': '8787257fa01bb3680e0240d1a39189eaa97dbdff7432edd71599caa1df0b95a2',
      'libfreetype.dylib': '009425a33bf911c6b6a6ff94fa3001f2857a2c81c161d4b23c06b2beae75c1b7',
      'libfribidi.dylib': '2fe4bbf9ba809cb8bbb8e824b6cb8550f3482805f657f96f97850b9d695acfd0',
      'libharfbuzz.dylib': '907e8119706b5684387078f8ff8dccd2a3864049219d91b018d0391e2784452f',
      'libmbedcrypto.dylib': '143750044eb77734348da5175b466b7ecac4f204b0ef9b6145c85f2467e90f28',
      'libmbedtls.dylib': '126dff43ce27f6e4ab37971ac46d3b543e377fc94f0c270af8e47b6ed140935e',
      'libmbedx509.dylib': '7cb55a6f1ae3b9f58d89fc7d2b04729c0dfb1b7dd0cb2ca6ab325f185c9ef538',
      'libmpv.dylib': '81e25efb40dc6df43b3e4df1e213770276c6e9dfcc30cbcc459b2074059b6cdb',
      'libpng16.dylib': '3e86719075fdb56dc102ece7c9cd7455e895d3677c4c380660c7b0d29c8575c6',
      'libswresample.dylib': '5d0bb5359de232d739d75d08d11097042381630101939073d3f6a7b55ba6575b',
      'libswscale.dylib': 'fe339d4b690214073c23ffe0e6f133e86f074b031e5ad4fc5304ae208f478627',
      'libuchardet.dylib': 'f7d84dda7730e99d66ca1cbe3dc26742aebae8a70f0bf45240bda62045919082',
      'libxml2.dylib': '29896755547f90781ab762098ac2fe4617106c6a12fc28aab5f1f9059117f901',
    },
    extract: (archive, into) => ['tar', '-xzf', archive, '-C', into],
    target: join(lib, 'macos'),
  }
}

const sha256 = async (path: string) =>
  new Bun.CryptoHasher('sha256').update(await Bun.file(path).arrayBuffer()).digest('hex')

const fail = (message: string): never => {
  console.error(`fetch-libmpv: ${message}`)
  process.exit(1)
}

const build =
  process.platform === 'win32'
    ? windows()
    : process.platform === 'darwin' && process.arch === 'arm64'
      ? macos()
      : fail(`no libmpv for ${process.platform} ${process.arch} (PRODUCT.md §28)`)
const printSha = process.env['PROJO_LIBMPV_PRINT_SHA'] === '1'

const pinned = async (directory: string) => {
  for (const [name, digest] of Object.entries(build.libraries)) {
    const path = join(directory, name)
    if (!(await Bun.file(path).exists()) || (await sha256(path)) !== digest) return false
  }
  return true
}

if (!printSha && (await pinned(build.target))) {
  console.log(`libmpv is already the pinned build (${build.url})`)
  process.exit(0)
}

const work = await mkdtemp(join(tmpdir(), 'projo-libmpv-'))
const cleanup = () => rm(work, { recursive: true, force: true })
const archive = join(work, 'archive')

console.log(`downloading ${build.url}`)
const response = await fetch(build.url)
if (!response.ok) fail(`download failed: HTTP ${response.status}`)
await Bun.write(archive, response)

const archiveDigest = await sha256(archive)
if (archiveDigest !== build.archiveSha256) {
  await cleanup()
  fail(`archive SHA-256 mismatch: expected ${build.archiveSha256}, got ${archiveDigest}`)
}

const extracted = Bun.spawnSync(build.extract(archive, work), { stderr: 'pipe' })
if (extracted.exitCode !== 0) {
  await cleanup()
  fail(`extraction failed: ${extracted.stderr.toString().trim()}`)
}

const from = join(work, build.root)
for (const [name, digest] of Object.entries(build.libraries)) {
  const actual = await sha256(join(from, name))
  if (printSha) console.log(`${name} SHA-256: ${actual}`)
  else if (actual !== digest) {
    await cleanup()
    fail(`${name} SHA-256 mismatch: expected ${digest}, got ${actual}`)
  }
}
if (printSha) {
  await cleanup()
  process.exit(0)
}

await mkdir(build.target, { recursive: true })
for (const name of Object.keys(build.libraries))
  await copyFile(join(from, name), join(build.target, name))
await cleanup()
console.log(`libmpv (${build.url}) → ${build.target}`)
