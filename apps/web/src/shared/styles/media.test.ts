import { expect, test } from 'bun:test'

import { media } from './media.ts'

const camel = (name: string) => name.replace(/-(\w)/g, (_, letter: string) => letter.toUpperCase())

test('matchMedia uses the queries of media.css', async () => {
  const css = await Bun.file(new URL('./media.css', import.meta.url)).text()
  const named: Record<string, string> = {}
  for (const [, name = '', query = ''] of css.matchAll(/@custom-media --([\w-]+) (.+);/g))
    // A device is built from the queries above it: `(--touch)` stands for `media.touch`.
    named[camel(name)] = query.replace(/\(--([\w-]+)\)/g, (_, used: string) => named[camel(used)]!)
  expect(named).toEqual(media)
})
