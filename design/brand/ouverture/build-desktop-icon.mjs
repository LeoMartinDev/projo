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
