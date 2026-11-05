import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFile, readdir } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const sharp = require('sharp')
const root = dirname(fileURLToPath(import.meta.url))
const repo = resolve(root, '../../..')
const files = []
async function walk(folder, prefix = '') {
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue
    if (entry.isDirectory()) await walk(join(folder, entry.name), prefix + entry.name + '/')
    else files.push(prefix + entry.name)
  }
}
await walk(root)
let pngCount = 0, transparentCount = 0, maskableCount = 0
for (const file of files.filter((file) => file.endsWith('.png'))) {
  const input = sharp(join(root, file))
  const metadata = await input.metadata()
  const expected = file.match(/-(\d+)\.png$/)?.[1]
  if (expected) {
    assert.equal(metadata.width, Number(expected), file + ' width')
    assert.equal(metadata.height, Number(expected), file + ' height')
  }
  const { data, info } = await input.ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const isTransparent = file.startsWith('png/transparent/') || (file.startsWith('png/lockups/') && !file.includes('-on-')) || file.includes('/transparent-') || /native\/android-(adaptive-foreground|monochrome)/.test(file)
  const isOpaque = file.startsWith('pwa/') || file.startsWith('apple/') || file.startsWith('png/background/') || file.startsWith('native/ios-') || (file.startsWith('png/lockups/') && file.includes('-on-'))
  let minAlpha = 255, maxAlpha = 0
  for (let at = 3; at < data.length; at += 4) {
    minAlpha = Math.min(minAlpha, data[at]); maxAlpha = Math.max(maxAlpha, data[at])
  }
  if (isTransparent) {
    assert.equal(minAlpha, 0, file + ' must have transparency')
    assert.equal(maxAlpha, 255, file + ' must contain an opaque mark')
    assert.equal(data[3], 0, file + ' transparent corner')
    transparentCount++
  }
  if (isOpaque) assert.equal(minAlpha, 255, file + ' must have an opaque background')
  if (file.startsWith('native/ios-')) assert.equal(metadata.hasAlpha, false, file + ' must have no alpha channel')
  if (file.includes('icon-maskable-')) {
    let maxRadius = 0
    const light = file.includes('/light/')
    for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
      const at = (y * info.width + x) * 4
      const foreground = light ? Math.max(data[at], data[at + 1], data[at + 2]) < 90 : Math.min(data[at], data[at + 1], data[at + 2]) > 200
      if (foreground) maxRadius = Math.max(maxRadius, Math.hypot(x + .5 - info.width / 2, y + .5 - info.height / 2))
    }
    assert(maxRadius <= info.width * .4, file + ' outside circular safe zone')
    maskableCount++
  }
  pngCount++
}
for (const file of files.filter((file) => file.endsWith('.ico'))) {
  const data = await readFile(join(root, file))
  assert.equal(data.readUInt16LE(2), 1, file + ' ICO header')
  const count = data.readUInt16LE(4)
  assert(count >= 3, file + ' must contain multiple sizes')
  for (let i = 0; i < count; i++) {
    const at = 6 + i * 16, length = data.readUInt32LE(at + 8), offset = data.readUInt32LE(at + 12)
    assert(offset + length <= data.length, file + ' directory bounds')
    const metadata = await sharp(data.subarray(offset, offset + length)).metadata()
    assert.equal(metadata.width, data[at] || 256, file + ' embedded width')
    assert.equal(metadata.height, data[at + 1] || 256, file + ' embedded height')
  }
}
const icns = await readFile(join(root, 'native/macos.icns'))
assert.equal(icns.toString('ascii', 0, 4), 'icns')
assert.equal(icns.readUInt32BE(4), icns.length)
let at = 8, representations = 0
while (at < icns.length) {
  const size = icns.readUInt32BE(at + 4)
  assert(size > 8 && at + size <= icns.length)
  const metadata = await sharp(icns.subarray(at + 8, at + size)).metadata()
  assert.equal(metadata.width, metadata.height)
  at += size; representations++
}
assert.equal(representations, 7)
const manifest = JSON.parse(await readFile(join(repo, 'apps/web/public/manifest.webmanifest'), 'utf8'))
for (const icon of manifest.icons) {
  const metadata = await sharp(join(repo, 'apps/web/public', icon.src)).metadata()
  assert.equal(icon.sizes, `${metadata.width}x${metadata.height}`)
  assert.equal(icon.type, 'image/png')
}
const html = await readFile(join(repo, 'apps/web/index.html'), 'utf8')
for (const path of ['/icons/ouverture/favicon.svg', '/icons/ouverture/favicon.ico', '/icons/ouverture/apple-touch-icon.png']) {
  assert(html.includes(path), 'Missing HTML link: ' + path)
  await readFile(join(repo, 'apps/web/public', path))
}
const vectorFiles = files.filter((file) => file.endsWith('.svg'))
for (const file of vectorFiles) {
  const data = await readFile(join(root, file), 'utf8')
  assert(!/<text\b|<image\b/.test(data), file + ' must have self-contained vector outlines')
  assert(data.includes('<path'), file + ' must include vector paths')
}
const summary = { png: pngCount, transparent: transparentCount, maskable: maskableCount, svg: vectorFiles.length, ico: 4, icns: representations, manifest: 'valid', html: 'valid' }
await import('node:fs/promises').then(({ writeFile }) => writeFile(join(root, 'validation.json'), JSON.stringify(summary, null, 2) + '\n'))
console.log(JSON.stringify(summary))
