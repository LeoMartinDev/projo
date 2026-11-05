import { createRequire } from 'node:module'
import { readFile, writeFile, mkdir, copyFile, readdir } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const sharp = require('sharp')
const root = dirname(fileURLToPath(import.meta.url))
const repo = resolve(root, '../../..')
const colors = { dark: '#0a0a0b', light: '#f4f4f5', white: '#ffffff', ivory: '#f5f3ea' }
const source = await readFile(join(root, 'source/symbol.svg'), 'utf8')
const paths = [...source.matchAll(/<path d="([^"]+)"/g)].map((m) => m[1])
if (paths.length !== 2) throw new Error('Expected the two approved curtain shapes')
const mark = (fill = colors.white, width = 640, x, y) => {
  const height = width * 508 / 558
  return `<g fill="${fill}" transform="translate(${x ?? (1024 - width) / 2} ${y ?? (1024 - height) / 2}) scale(${width / 558})">${paths.map((d) => `<path d="${d}"/>`).join('')}</g>`
}
const svg = (body, width = 1024, height = width, extras = '') =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" ${extras}>${body}</svg>\n`
const ambient = `<defs><radialGradient id="blue" cx="78%" cy="12%" r="90%"><stop stop-color="#345563"/><stop offset="1" stop-color="#0a0a0b" stop-opacity="0"/></radialGradient><radialGradient id="sage" cx="9%" cy="86%" r="78%"><stop stop-color="#4d6052" stop-opacity=".85"/><stop offset="1" stop-color="#0a0a0b" stop-opacity="0"/></radialGradient></defs><path fill="${colors.dark}" d="M0 0h1024v1024H0z"/><path fill="url(#blue)" d="M0 0h1024v1024H0z"/><path fill="url(#sage)" d="M0 0h1024v1024H0z"/>`
const background = (theme) => theme === 'ambient' ? ambient : `<path fill="${theme === 'light' ? colors.light : colors.dark}" d="M0 0h1024v1024H0z"/>`
const artwork = (theme, width = 640) => svg(background(theme) + mark(theme === 'light' ? colors.dark : colors.white, width))
const write = async (path, data) => {
  await mkdir(dirname(join(root, path)), { recursive: true })
  await writeFile(join(root, path), data)
}
const png = async (path, input, size) => {
  const output = sharp(Buffer.from(input)).resize(size, size)
  if (/^(pwa|apple|png\/background)\//.test(path) || /^native\/(ios-|android-background)/.test(path)) output.removeAlpha()
  await write(path, await output.png().toBuffer())
}

// Outline the application's own Geist font; exported lockups need no installed font.
const font = await readFile(join(repo, 'apps/web/node_modules/geist/dist/fonts/geist-sans/Geist-Bold.ttf'))
const tables = {}
for (let i = 0; i < font.readUInt16BE(4); i++) {
  const at = 12 + i * 16
  tables[font.toString('ascii', at, at + 4)] = font.readUInt32BE(at + 8)
}
const upem = font.readUInt16BE(tables.head + 18)
const longLoca = font.readInt16BE(tables.head + 50) === 1
const metrics = font.readUInt16BE(tables.hhea + 34)
const location = (id) => tables.glyf + (longLoca ? font.readUInt32BE(tables.loca + id * 4) : font.readUInt16BE(tables.loca + id * 2) * 2)
const advance = (id) => font.readUInt16BE(tables.hmtx + Math.min(id, metrics - 1) * 4)
let cmap
for (let i = 0; i < font.readUInt16BE(tables.cmap + 2); i++) {
  const at = tables.cmap + 4 + i * 8
  const sub = tables.cmap + font.readUInt32BE(at + 4)
  if (font.readUInt16BE(sub) === 4 && (cmap === undefined || font.readUInt16BE(at) === 3)) cmap = sub
}
if (cmap === undefined) throw new Error('Geist font needs a Unicode BMP cmap')
const glyphId = (char) => {
  const code = char.codePointAt(0)
  const count = font.readUInt16BE(cmap + 6) / 2
  for (let i = 0; i < count; i++) {
    const end = font.readUInt16BE(cmap + 14 + i * 2)
    const start = font.readUInt16BE(cmap + 16 + count * 2 + i * 2)
    if (code < start || code > end) continue
    const delta = font.readInt16BE(cmap + 16 + count * 4 + i * 2)
    const pos = cmap + 16 + count * 6 + i * 2
    const range = font.readUInt16BE(pos)
    const id = range ? font.readUInt16BE(pos + range + (code - start) * 2) : code
    return id ? (id + delta) & 65535 : 0
  }
  throw new Error(`Missing glyph: ${char}`)
}
const contourPath = (points) => {
  const first = points[0], last = points.at(-1)
  const start = first.on ? first : last.on ? last : { x: (last.x + first.x) / 2, y: (last.y + first.y) / 2 }
  const remaining = first.on ? points.slice(1) : last.on ? points.slice(0, -1) : points.slice()
  remaining.push({ ...start, on: true })
  let d = `M${start.x} ${start.y}`
  for (let i = 0; i < remaining.length; i++) {
    const p = remaining[i]
    if (p.on) d += `L${p.x} ${p.y}`
    else {
      const next = remaining[i + 1]
      if (next.on) { d += `Q${p.x} ${p.y} ${next.x} ${next.y}`; i++ }
      else d += `Q${p.x} ${p.y} ${(p.x + next.x) / 2} ${(p.y + next.y) / 2}`
    }
  }
  return d + 'Z'
}
const glyphCache = new Map()
const glyph = (id, depth = 0) => {
  if (depth > 10) throw new Error('Recursive font glyph')
  if (glyphCache.has(id)) return glyphCache.get(id)
  const start = location(id)
  if (start === location(id + 1)) return ''
  const count = font.readInt16BE(start)
  let at = start + 10, result = ''
  if (count < 0) {
    let flags
    do {
      flags = font.readUInt16BE(at)
      const child = font.readUInt16BE(at + 2)
      at += 4
      const words = flags & 1
      const a = words ? font.readInt16BE(at) : font.readInt8(at)
      const b = words ? font.readInt16BE(at + 2) : font.readInt8(at + 1)
      at += words ? 4 : 2
      if (!(flags & 2)) throw new Error('Unsupported point-matched font component')
      let xx = 1, xy = 0, yx = 0, yy = 1
      const fixed = () => { const v = font.readInt16BE(at) / 16384; at += 2; return v }
      if (flags & 8) xx = yy = fixed()
      else if (flags & 64) { xx = fixed(); yy = fixed() }
      else if (flags & 128) { xx = fixed(); xy = fixed(); yx = fixed(); yy = fixed() }
      result += `<g transform="matrix(${xx} ${xy} ${yx} ${yy} ${a} ${b})">${glyph(child, depth + 1)}</g>`
    } while (flags & 32)
  } else if (count > 0) {
    const ends = []
    for (let i = 0; i < count; i++) { ends.push(font.readUInt16BE(at)); at += 2 }
    const instructions = font.readUInt16BE(at)
    at += 2 + instructions
    const flags = []
    while (flags.length <= ends.at(-1)) {
      const flag = font.readUInt8(at++)
      flags.push(flag)
      if (flag & 8) { let repeated = font.readUInt8(at++); while (repeated--) flags.push(flag) }
    }
    const points = flags.map((flag) => ({ on: Boolean(flag & 1), x: 0, y: 0 }))
    for (const [axis, short, same] of [['x', 2, 16], ['y', 4, 32]]) {
      let value = 0
      flags.forEach((flag, i) => {
        if (flag & short) value += font.readUInt8(at++) * (flag & same ? 1 : -1)
        else if (!(flag & same)) { value += font.readInt16BE(at); at += 2 }
        points[i][axis] = value
      })
    }
    let offset = 0, d = ''
    for (const end of ends) { d += contourPath(points.slice(offset, end + 1)); offset = end + 1 }
    result = `<path d="${d}"/>`
  }
  glyphCache.set(id, result)
  return result
}
const lettering = (fill, x, baseline, size) => {
  const scale = size / upem
  let cursor = 0, body = ''
  for (const char of 'projo.') {
    const id = glyphId(char)
    body += `<g transform="translate(${cursor} 0)">${glyph(id)}</g>`
    cursor += advance(id) - upem * .035
  }
  return `<g fill="${fill}" transform="translate(${x} ${baseline}) scale(${scale} ${-scale})">${body}</g>`
}

for (const [name, fill] of [['white', colors.white], ['black', colors.dark], ['ivory', colors.ivory], ['current-color', 'currentColor']]) {
  const input = svg(mark(fill))
  await write(`svg/symbol-${name}.svg`, input)
  if (name !== 'current-color') {
    for (const size of [32, 64, 128, 256, 512, 1024, 2048]) await png(`png/transparent/${name}/symbol-${size}.png`, input, size)
  }
  const horizontal = svg(mark(fill, 242, 32, 37) + lettering(fill, 328, 227, 234), 1120, 300)
  const stacked = svg(mark(fill, 430, 297, 60) + lettering(fill, 239, 744, 210), 1024, 840)
  await write(`svg/logo-horizontal-${name}.svg`, horizontal)
  await write(`svg/logo-stacked-${name}.svg`, stacked)
  if (name !== 'current-color') {
    await write(`png/lockups/logo-horizontal-${name}.png`, await sharp(Buffer.from(horizontal)).resize({ width: 2240 }).png().toBuffer())
    await write(`png/lockups/logo-stacked-${name}.png`, await sharp(Buffer.from(stacked)).resize({ width: 2048 }).png().toBuffer())
  }
}

for (const theme of ['dark', 'light', 'ambient']) {
  await write(`svg/icon-${theme}.svg`, artwork(theme))
  for (const size of [64, 128, 192, 256, 512, 1024, 2048]) await png(`png/background/${theme}/icon-${size}.png`, artwork(theme), size)
  for (const size of [192, 512]) await png(`pwa/${theme}/icon-${size}.png`, artwork(theme), size)
  for (const size of [192, 512, 1024]) await png(`pwa/${theme}/icon-maskable-${size}.png`, artwork(theme, 540), size)
  for (const size of [120, 152, 167, 180]) await png(`apple/${theme}/apple-touch-icon-${size}.png`, artwork(theme), size)
  await png(`native/ios-${theme}-1024.png`, artwork(theme), 1024)
  const fill = theme === 'light' ? colors.dark : colors.white
  const surface = (width, height) => theme === 'ambient'
    ? `<g transform="scale(${width / 1024} ${height / 1024})">${ambient}</g>`
    : `<rect width="${width}" height="${height}" fill="${theme === 'light' ? colors.light : colors.dark}"/>`
  for (const [layout, width, height, body] of [
    ['horizontal', 1120, 300, mark(fill, 242, 32, 37) + lettering(fill, 328, 227, 234)],
    ['stacked', 1024, 840, mark(fill, 430, 297, 60) + lettering(fill, 239, 744, 210)],
  ]) {
    const input = svg(surface(width, height) + body, width, height)
    await write(`svg/logo-${layout}-on-${theme}.svg`, input)
    await write(`png/lockups/logo-${layout}-on-${theme}.png`, await sharp(Buffer.from(input)).resize({ width: width * 2 }).removeAlpha().png().toBuffer())
  }
}
await png('native/android-adaptive-foreground-1024.png', svg(mark(colors.white, 480)), 1024)
await png('native/android-monochrome-1024.png', svg(mark(colors.white, 480)), 1024)
await png('native/android-background-dark-1024.png', svg(background('dark')), 1024)
await png('native/android-background-light-1024.png', svg(background('light')), 1024)
await png('native/android-adaptive-foreground-black-1024.png', svg(mark(colors.dark, 480)), 1024)
await png('native/ios-tinted-1024.png', svg(background('dark') + mark(colors.white, 640)), 1024)

// SVG favicon follows the OS/browser color scheme; PNG/ICO provide an opaque fallback.
const adaptive = svg(`<style>svg{color:${colors.dark}}@media(prefers-color-scheme:dark){svg{color:${colors.white}}}</style>${mark('currentColor', 900)}`)
await write('favicon/favicon.svg', adaptive)
await write('favicon/safari-pinned-tab.svg', svg(mark('#000000', 900)))
const faviconArt = (fill) => svg(mark(fill, 900))
const faviconSizes = [16, 20, 24, 32, 48, 64, 96, 128, 256]
for (const size of faviconSizes) {
  await png(`favicon/dark/favicon-${size}.png`, svg(background('dark') + mark(colors.white, 850)), size)
  await png(`favicon/light/favicon-${size}.png`, svg(background('light') + mark(colors.dark, 850)), size)
  await png(`favicon/transparent-white/favicon-${size}.png`, faviconArt(colors.white), size)
  await png(`favicon/transparent-black/favicon-${size}.png`, faviconArt(colors.dark), size)
}
const ico = async (theme, sizes) => {
  const images = await Promise.all(sizes.map((size) => sharp(join(root, `favicon/${theme}/favicon-${size}.png`)).png().toBuffer()))
  const header = Buffer.alloc(6 + images.length * 16)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(images.length, 4)
  let offset = header.length
  images.forEach((data, i) => {
    const at = 6 + i * 16, size = sizes[i]
    header[at] = header[at + 1] = size === 256 ? 0 : size
    header.writeUInt16LE(1, at + 4)
    header.writeUInt16LE(32, at + 6)
    header.writeUInt32LE(data.length, at + 8)
    header.writeUInt32LE(offset, at + 12)
    offset += data.length
  })
  return Buffer.concat([header, ...images])
}
for (const theme of ['dark', 'light']) {
  await write(`favicon/favicon-${theme}.ico`, await ico(theme, [16, 32, 48]))
  await write(`native/windows-${theme}.ico`, await ico(theme, [16, 24, 32, 48, 64, 128, 256]))
}

// macOS .icns: PNG-backed Retina and standard representations.
const icnsParts = []
for (const [kind, size] of [['icp4', 16], ['icp5', 32], ['icp6', 64], ['ic07', 128], ['ic08', 256], ['ic09', 512], ['ic10', 1024]]) {
  const data = await sharp(Buffer.from(artwork('ambient'))).resize(size).png().toBuffer()
  const header = Buffer.alloc(8); header.write(kind, 0, 'ascii'); header.writeUInt32BE(data.length + 8, 4)
  icnsParts.push(header, data)
}
const icnsBody = Buffer.concat(icnsParts), icnsHeader = Buffer.alloc(8)
icnsHeader.write('icns', 0, 'ascii'); icnsHeader.writeUInt32BE(icnsBody.length + 8, 4)
await write('native/macos.icns', Buffer.concat([icnsHeader, icnsBody]))

const manifest = {
  name: 'projo', short_name: 'projo', start_url: '/', scope: '/', display: 'standalone',
  background_color: colors.dark, theme_color: colors.dark,
  icons: [
    ...[192, 512].map((size) => ({ src: `/icons/ouverture/icon-${size}.png`, sizes: `${size}x${size}`, type: 'image/png', purpose: 'any' })),
    ...[192, 512].map((size) => ({ src: `/icons/ouverture/icon-maskable-${size}.png`, sizes: `${size}x${size}`, type: 'image/png', purpose: 'maskable' })),
  ],
}
await write('web/manifest.webmanifest', JSON.stringify(manifest, null, 2) + '\n')
await write('web/head.html', `<link rel="icon" href="/icons/ouverture/favicon.ico" sizes="16x16 32x32 48x48" />\n<link rel="icon" href="/icons/ouverture/favicon.svg" type="image/svg+xml" sizes="any" />\n<link rel="apple-touch-icon" href="/icons/ouverture/apple-touch-icon.png" sizes="180x180" />\n<link rel="manifest" href="/manifest.webmanifest" />\n<meta name="theme-color" content="${colors.dark}" />\n`)
for (const size of [192, 512]) {
  await copyFile(join(root, `pwa/dark/icon-${size}.png`), await publicPath(`icon-${size}.png`))
  await copyFile(join(root, `pwa/dark/icon-maskable-${size}.png`), await publicPath(`icon-maskable-${size}.png`))
}
await copyFile(join(root, 'apple/dark/apple-touch-icon-180.png'), await publicPath('apple-touch-icon.png'))
await copyFile(join(root, 'favicon/favicon.svg'), await publicPath('favicon.svg'))
await copyFile(join(root, 'favicon/favicon-dark.ico'), await publicPath('favicon.ico'))
await copyFile(join(root, 'svg/symbol-current-color.svg'), await publicPath('symbol.svg'))
await copyFile(join(repo, 'apps/web/node_modules/geist/LICENSE.txt'), join(root, 'LICENSE-Geist.txt'))
async function publicPath(name) {
  const destination = join(repo, 'apps/web/public/icons/ouverture', name)
  await mkdir(dirname(destination), { recursive: true })
  return destination
}

// Contact sheet is rendered from the vector master, never from the proposal raster.
const embed = async (input, width, height = width) => {
  const data = await sharp(Buffer.from(input)).resize(width, height).png().toBuffer()
  return `data:image/png;base64,${data.toString('base64')}`
}
let board = `<rect width="1600" height="1700" fill="#101113"/><style>text{font-family:Arial,sans-serif;fill:#f4f4f5}.muted{fill:#a1a1aa}</style><text x="80" y="100" font-size="38" font-weight="700">projo. — Ouverture</text><text x="80" y="145" font-size="20" class="muted">Identité et icônes</text>`
for (const [i, theme] of ['dark', 'light', 'ambient'].entries()) {
  const x = 80 + i * 500
  board += `<image x="${x}" y="200" width="440" height="440" href="${await embed(artwork(theme), 440)}"/><text x="${x}" y="687" font-size="24">${['Sombre', 'Clair', 'Ambiance'][i]}</text>`
}
board += `<rect x="80" y="745" width="1440" height="235" rx="24" fill="#17191c"/>${mark(colors.white, 154, 130, 787)}${lettering(colors.white, 326, 907, 180)}<text x="1100" y="855" font-size="21" class="muted">SVG vectoriels</text><text x="1100" y="891" font-size="21" class="muted">PNG transparents</text>`
board += `<text x="80" y="1055" font-size="27" font-weight="700">Favicon · taille réelle</text>`
let x = 80
for (const size of [16, 24, 32, 48, 64, 96]) {
  const file = await readFile(join(root, `favicon/dark/favicon-${size}.png`))
  board += `<image x="${x}" y="1100" width="${size}" height="${size}" href="data:image/png;base64,${file.toString('base64')}"/><text x="${x}" y="1240" font-size="18" class="muted">${size} px</text>`
  x += 190
}
board += `<text x="80" y="1340" font-size="27" font-weight="700">PWA · découpes système</text>`
for (const [i, shape] of ['circle', 'rounded', 'square'].entries()) {
  const x = 80 + i * 290, size = 210
  board += `<defs><clipPath id="mask-${i}">${shape === 'circle' ? `<circle cx="${x + size / 2}" cy="1480" r="105"/>` : `<rect x="${x}" y="1375" width="${size}" height="${size}" rx="${shape === 'rounded' ? 49 : 0}"/>`}</clipPath></defs><image x="${x}" y="1375" width="${size}" height="${size}" clip-path="url(#mask-${i})" href="${await embed(artwork('dark', 540), size)}"/>`
}
board += `<text x="1000" y="1455" font-size="22" class="muted">192 / 512 px + maskable</text><text x="1000" y="1500" font-size="22" class="muted">Apple Touch · iOS · Android</text><text x="1000" y="1545" font-size="22" class="muted">ICO Windows · ICNS macOS</text>`
await write('preview.png', await sharp(Buffer.from(svg(board, 1600, 1700))).png().toBuffer())

const fileList = async (folder, prefix = '') => {
  const files = []
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const name = prefix + entry.name
    if (entry.isDirectory() && entry.name !== 'node_modules') files.push(...await fileList(join(folder, entry.name), name + '/'))
    else if (entry.isFile() && !entry.name.endsWith('.zip')) files.push(name)
  }
  return files.sort()
}
await write('inventory.json', JSON.stringify(await fileList(root), null, 2) + '\n')
console.log('Built Ouverture brand pack and apps/web/public/icons/ouverture')
