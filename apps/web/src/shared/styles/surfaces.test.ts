import { expect, test } from 'bun:test'

import { Glob } from 'bun'

// The surface language of tokens.css: flat translucent colours and backdrop
// blurs come from its steps and materials, never from a stylesheet of its own.

const src = new URL('../../', import.meta.url).pathname.replace(/^\/(\w:)/, '$1')

const stylesheets = async () => {
  const files: { path: string; css: string }[] = []
  for await (const path of new Glob('**/*.css').scan(src)) {
    if (path.replaceAll('\\', '/').endsWith('shared/styles/tokens.css')) continue
    files.push({ path, css: await Bun.file(`${src}/${path}`).text() })
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
