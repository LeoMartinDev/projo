import { expect, test } from 'bun:test'

import { Glob } from 'bun'

import { geistCss, weights } from './scripts/fonts.ts'

// fonts/ holds Geist split by scripts/fonts.ts and committed: it must match the installed geist
// (a geist upgrade fails here until `bun run --cwd packages/design fonts` regenerates it), and the
// stylesheets must not ask for a weight the files were cut without.

const root = new URL('../../', import.meta.url).pathname.replace(/^\/(\w:)/, '$1')

test('fonts/geist.css matches the installed geist', async () => {
  expect(await Bun.file(`${root}packages/design/fonts/geist.css`).text()).toBe(await geistCss())
  for (const file of ['geist', 'geist-mono'])
    for (const part of ['core', 'rest'])
      expect(await Bun.file(`${root}packages/design/fonts/${file}-${part}.woff2`).exists()).toBe(
        true,
      )
}, 20_000)

test(`stylesheets set weights between ${weights.min} and ${weights.max}`, async () => {
  const outside: string[] = []
  for (const folder of ['packages/design', 'apps/web/src', 'apps/www/src'])
    for await (const path of new Glob('**/*.{css,ts,tsx}').scan(`${root}${folder}`)) {
      if (path.includes('node_modules')) continue
      const text = await Bun.file(`${root}${folder}/${path}`).text()
      const declarations = /font-?[wW]eight:\s*'?(\d+|normal|bold|bolder|lighter)'?\s*[;,}]/g
      for (const match of text.matchAll(declarations)) {
        const value = match[1] ?? ''
        const weight = value === 'normal' ? 400 : value === 'bold' ? 700 : Number(value)
        if (Number.isNaN(weight) || weight < weights.min || weight > weights.max)
          outside.push(`${folder}/${path}: ${match[0]}`)
      }
    }
  expect(outside).toEqual([])
})
