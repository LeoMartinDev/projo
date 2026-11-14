// Packs a desktop release (PRODUCT.md §28.10) from the installer `bun run build` wrote: copies it
// to <out>/projo-desktop-X.Y.Z-setup.exe, signs it for the updater, bound to its version
// (TAURI_SIGNING_PRIVATE_KEY and TAURI_SIGNING_PRIVATE_KEY_PASSWORD), and writes the updater's
// latest.json next to it. CI uploads both to the GitHub release desktop-vX.Y.Z.
//
//   bun apps/desktop/scripts/package-release.ts [--out dist/desktop-release]
import { copyFile, mkdir, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { updaterManifest } from './updater-manifest.ts'

// Typed on the const so that a call narrows like a throw.
const fail: (message: string) => never = (message) => {
  console.error(`package-release: ${message}`)
  process.exit(1)
}

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: { out: { type: 'string', default: 'dist/desktop-release' } },
})
const out = values.out
const desktop = join(import.meta.dir, '..')
const version: unknown = (await Bun.file(join(desktop, 'package.json')).json()).version
if (typeof version !== 'string' || !/^\d+\.\d+\.\d+$/u.test(version))
  fail(`apps/desktop/package.json's version must be X.Y.Z, got ${String(version)}`)

const pubkey: unknown = (await Bun.file(join(desktop, 'src-tauri', 'tauri.conf.json')).json())
  .plugins?.updater?.pubkey
if (typeof pubkey !== 'string' || pubkey === '')
  fail('plugins.updater.pubkey of tauri.conf.json is empty: the app could verify no update')
if (!process.env['TAURI_SIGNING_PRIVATE_KEY']) fail('TAURI_SIGNING_PRIVATE_KEY is not set')

const nsis = join(
  process.env['CARGO_TARGET_DIR'] ?? join(desktop, 'src-tauri', 'target'),
  'release',
  'bundle',
  'nsis',
)
const built = `projo_${version}_x64-setup.exe`
if (!(await readdir(nsis).catch((): string[] => [])).includes(built))
  fail(`${join(nsis, built)} is missing`)

const fileName = `projo-desktop-${version}-setup.exe`
const installer = join(out, fileName)
await mkdir(out, { recursive: true })
await copyFile(join(nsis, built), installer)

// The Tauri CLI of the build scripts; --app-version puts the version in the signature's trusted
// comment, which the app requires (requireSignedVersion).
const signed = Bun.spawnSync(
  ['bunx', '@tauri-apps/cli@2.12.4', 'signer', 'sign', '--app-version', version, installer],
  { stdout: 'inherit', stderr: 'inherit' },
)
if (signed.exitCode !== 0) fail('signing the installer failed')

const signature = (await Bun.file(`${installer}.sig`).text()).trim()
const manifest = updaterManifest({
  version,
  fileName,
  signature,
  publishedAt: new Date(),
})
await Bun.write(join(out, 'latest.json'), `${JSON.stringify(manifest, undefined, 2)}\n`)
console.log(`package-release: ${installer} and latest.json in ${out}`)
