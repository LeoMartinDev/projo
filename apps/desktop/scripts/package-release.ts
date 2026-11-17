// Packs this platform's part of a desktop release (PRODUCT.md §28.10) from what `bun run build`
// wrote, signs its update for the updater, bound to its version (TAURI_SIGNING_PRIVATE_KEY and
// TAURI_SIGNING_PRIVATE_KEY_PASSWORD), and leaves `updater-<platform>.json` for
// write-updater-manifest.ts:
// - Windows: projo-desktop-X.Y.Z-setup.exe, the NSIS installer (download and update);
// - macOS: projo-desktop-X.Y.Z-macos-arm64.dmg (download) and
//   projo-desktop-X.Y.Z-macos-arm64.app.tar.gz (the app, for the updater).
// CI uploads them to the GitHub release desktop-vX.Y.Z.
//
//   bun apps/desktop/scripts/package-release.ts [--out dist/desktop-release]
import { copyFile, mkdir, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import type { UpdaterEntry } from './updater-manifest.ts'

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

const bundle = join(
  process.env['CARGO_TARGET_DIR'] ?? join(desktop, 'src-tauri', 'target'),
  'release',
  'bundle',
)

const built = async (directory: string, name: string) => {
  const path = join(bundle, directory, name)
  if (!(await readdir(join(bundle, directory)).catch((): string[] => [])).includes(name))
    fail(`${path} is missing`)
  return path
}

const run = (command: string[], what: string) => {
  const result = Bun.spawnSync(command, { stdout: 'inherit', stderr: 'inherit' })
  if (result.exitCode !== 0) fail(`${what} failed`)
}

// The Tauri CLI of the build scripts; --app-version puts the version in the signature's trusted
// comment, which the app requires (requireSignedVersion).
const sign = async (path: string) => {
  run(
    ['bunx', '@tauri-apps/cli@2.12.4', 'signer', 'sign', '--app-version', version, path],
    `signing ${path}`,
  )
  return (await Bun.file(`${path}.sig`).text()).trim()
}

await mkdir(out, { recursive: true })

const packWindows = async (): Promise<UpdaterEntry> => {
  const fileName = `projo-desktop-${version}-setup.exe`
  const installer = join(out, fileName)
  await copyFile(await built('nsis', `projo_${version}_x64-setup.exe`), installer)
  return { platform: 'windows-x86_64', fileName, signature: await sign(installer) }
}

const packMacos = async (): Promise<UpdaterEntry> => {
  const base = `projo-desktop-${version}-macos-arm64`
  await copyFile(await built('dmg', `projo_${version}_aarch64.dmg`), join(out, `${base}.dmg`))
  const app = await built('macos', 'projo.app')
  const fileName = `${base}.app.tar.gz`
  const archive = join(out, fileName)
  // The updater unpacks it in place of the running app: projo.app at the archive's root, without
  // AppleDouble files (COPYFILE_DISABLE).
  const tar = Bun.spawnSync(['tar', '-czf', archive, '-C', join(app, '..'), 'projo.app'], {
    stderr: 'inherit',
    env: { ...process.env, COPYFILE_DISABLE: '1' },
  })
  if (tar.exitCode !== 0) fail('packing projo.app failed')
  return { platform: 'darwin-aarch64', fileName, signature: await sign(archive) }
}

const entry =
  process.platform === 'win32'
    ? await packWindows()
    : process.platform === 'darwin' && process.arch === 'arm64'
      ? await packMacos()
      : fail(`no desktop release for ${process.platform} ${process.arch}`)
await Bun.write(
  join(out, `updater-${entry.platform}.json`),
  `${JSON.stringify(entry, undefined, 2)}\n`,
)
console.log(`package-release: ${entry.platform} packed in ${out}`)
