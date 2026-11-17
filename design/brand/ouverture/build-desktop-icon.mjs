// Windows icon of the desktop app (apps/desktop): the white symbol on a dark rounded square,
// transparent outside the corners. Small sizes draw the symbol a little larger to stay legible.
import { createRequire } from 'node:module'
import { readFile, writeFile, copyFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const sharp = require('sharp')
const root = dirname(fileURLToPath(import.meta.url))
const repo = resolve(root, '../../..')
const source = await readFile(join(root, 'source/symbol.svg'), 'utf8')
const paths = [...source.matchAll(/<path d="([^"]+)"/g)].map((m) => m[1])
if (paths.length !== 2) throw new Error('Expected the two approved curtain shapes')

const canvas = 1024
const radius = 224
const markWidth = (size) => (size <= 24 ? 700 : size <= 48 ? 640 : 580)
const artwork = (size) => {
  const width = markWidth(size)
  const height = (width * 508) / 558
  const mark = `<g fill="#ffffff" transform="translate(${(canvas - width) / 2} ${(canvas - height) / 2}) scale(${width / 558})">${paths.map((d) => `<path d="${d}"/>`).join('')}</g>`
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${canvas}" height="${canvas}" viewBox="0 0 ${canvas} ${canvas}"><rect width="${canvas}" height="${canvas}" rx="${radius}" fill="#0a0a0b"/>${mark}</svg>`
}

const sizes = [16, 24, 32, 48, 64, 128, 256]
const images = await Promise.all(
  sizes.map((size) => sharp(Buffer.from(artwork(size))).resize(size, size).png().toBuffer()),
)
const header = Buffer.alloc(6 + images.length * 16)
header.writeUInt16LE(1, 2)
header.writeUInt16LE(images.length, 4)
let offset = header.length
images.forEach((data, i) => {
  const at = 6 + i * 16
  const size = sizes[i]
  header[at] = header[at + 1] = size === 256 ? 0 : size
  header.writeUInt16LE(1, at + 4)
  header.writeUInt16LE(32, at + 6)
  header.writeUInt32LE(data.length, at + 8)
  header.writeUInt32LE(offset, at + 12)
  offset += data.length
})
const ico = Buffer.concat([header, ...images])
await writeFile(join(root, 'native/windows-desktop.ico'), ico)
await copyFile(join(root, 'native/windows-desktop.ico'), join(repo, 'apps/desktop/src-tauri/icons/icon.ico'))
console.log('Built native/windows-desktop.ico and apps/desktop/src-tauri/icons/icon.ico')

// macOS icon of the desktop app: Apple's grid (a rounded square of 824 px with a soft shadow on a
// 1024 px canvas, transparent around it), the same dark square and white symbol as Windows'.
const macTile = 824
const macRadius = 185
const macArtwork = (size) => {
  const width = (size <= 32 ? 0.62 : 0.57) * macTile
  const height = (width * 508) / 558
  const offset = (canvas - macTile) / 2
  const mark = `<g fill="#ffffff" transform="translate(${(canvas - width) / 2} ${(canvas - height) / 2}) scale(${width / 558})">${paths.map((d) => `<path d="${d}"/>`).join('')}</g>`
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${canvas}" height="${canvas}" viewBox="0 0 ${canvas} ${canvas}"><defs><filter id="shadow" x="-10%" y="-10%" width="120%" height="130%"><feDropShadow dx="0" dy="10" stdDeviation="10" flood-color="#000000" flood-opacity="0.3"/></filter></defs><rect x="${offset}" y="${offset}" width="${macTile}" height="${macTile}" rx="${macRadius}" fill="#0a0a0b" filter="url(#shadow)"/>${mark}</svg>`
}
const macPng = (size) => sharp(Buffer.from(macArtwork(size))).resize(size, size).png().toBuffer()
const icnsParts = []
for (const [kind, size] of [
  ['icp4', 16],
  ['ic11', 32],
  ['icp5', 32],
  ['ic12', 64],
  ['icp6', 64],
  ['ic07', 128],
  ['ic13', 256],
  ['ic08', 256],
  ['ic14', 512],
  ['ic09', 512],
  ['ic10', 1024],
]) {
  const data = await macPng(size)
  const header = Buffer.alloc(8)
  header.write(kind, 0, 'ascii')
  header.writeUInt32BE(data.length + 8, 4)
  icnsParts.push(header, data)
}
const icnsBody = Buffer.concat(icnsParts)
const icnsHeader = Buffer.alloc(8)
icnsHeader.write('icns', 0, 'ascii')
icnsHeader.writeUInt32BE(icnsBody.length + 8, 4)
await writeFile(join(root, 'native/macos-desktop.icns'), Buffer.concat([icnsHeader, icnsBody]))
const icons = join(repo, 'apps/desktop/src-tauri/icons')
await copyFile(join(root, 'native/macos-desktop.icns'), join(icons, 'icon.icns'))
// The window's icon outside a bundle (`tauri dev`: the Dock's).
await writeFile(join(icons, 'icon.png'), await macPng(512))

// macOS menu bar: a template image (the symbol's shape in black on transparency, 18 pt at 2x),
// which the system tints for a light or dark menu bar.
const trayWidth = 32
const trayHeight = (trayWidth * 508) / 558
const tray = `<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 36 36"><g fill="#000000" transform="translate(${(36 - trayWidth) / 2} ${(36 - trayHeight) / 2}) scale(${trayWidth / 558})">${paths.map((d) => `<path d="${d}"/>`).join('')}</g></svg>`
await writeFile(join(icons, 'tray-template.png'), await sharp(Buffer.from(tray)).png().toBuffer())
console.log('Built native/macos-desktop.icns, icons/icon.icns, icons/icon.png and icons/tray-template.png')
