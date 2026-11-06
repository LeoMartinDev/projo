import { expect, test } from 'bun:test'

import { Glob } from 'bun'

// The surface language of tokens.css: flat translucent colours and backdrop
// blurs come from its steps and materials, never from a stylesheet of its own.
// Holds for this package and for every app that draws with it.

const root = new URL('../../', import.meta.url).pathname.replace(/^\/(\w:)/, '$1')
const folders = ['packages/design', 'apps/web/src', 'apps/www/src']

const stylesheets = async () => {
  const files: { path: string; css: string }[] = []
  for (const folder of folders)
    for await (const path of new Glob('**/*.css').scan(`${root}${folder}`)) {
      const file = `${folder}/${path.replaceAll('\\', '/')}`
      if (file === 'packages/design/tokens.css' || file.includes('/node_modules/')) continue
      files.push({ path: file, css: await Bun.file(`${root}${file}`).text() })
    }
  return files
}

const offenders = (files: { path: string; css: string }[], pattern: RegExp) =>
  files.flatMap(({ path, css }) =>
    [...css.matchAll(pattern)].map(
      (match) => `${path}:${css.slice(0, match.index).split('\n').length}: ${match[0].trim()}`,
    ),
  )

test('flat translucent backgrounds use a fill, shade or material token', async () => {
  expect(
    offenders(await stylesheets(), /\bbackground(?:-color)?:\s*(?:rgba?|hsla?)\([^)]*\)/g),
  ).toEqual([])
})

test('backdrop blurs use a --blur-* token', async () => {
  expect(
    offenders(
      await stylesheets(),
      /backdrop-filter:(?!\s*(?:var\(--blur-[\w-]+\)|none)\s*;)[^;{]+;/g,
    ),
  ).toEqual([])
})
