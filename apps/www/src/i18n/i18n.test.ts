import { readFileSync } from 'node:fs'

import { expect, test } from 'bun:test'

import { en, fr } from './messages.ts'
import {
  locales,
  pageContext,
  pageFile,
  pages,
  pageUrl,
  renderTemplate,
  type Site,
} from './pages.ts'
import { preferredLocale } from './preferred.ts'

const template = (name: string) =>
  readFileSync(new URL(`../pages/${name}`, import.meta.url), 'utf8')

const keys = (value: unknown, prefix = ''): string[] =>
  value instanceof Object
    ? Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
        keys(child, `${prefix}${key}.`),
      )
    : [prefix.slice(0, -1)]

const site: Site = {
  releases: [
    {
      version: '1.12.0',
      publishedAt: new Date('2026-11-05T17:12:32Z'),
      sections: [{ title: 'Features', items: [{ scope: 'web', text: 'install the app' }] }],
      notes: [],
    },
  ],
  fallbackVersion: '0.0.0',
}

test('the version badge shows the latest release and links to its notes', () => {
  expect(pageContext('fr', pages[0], site).version).toEqual({
    number: '1.12.0',
    short: '1.12',
    url: '/fr/changelog/#v1.12.0',
  })
  expect(
    pageContext('en', pages[0], { releases: [], fallbackVersion: '1.13.0' }).version.number,
  ).toBe('1.13.0')
})

test('English and French have the same texts', () => {
  expect(keys(en).sort()).toEqual(keys(fr).sort())
})

test('every page renders in every language, with no placeholder left', () => {
  for (const locale of locales)
    for (const page of pages) {
      const html = renderTemplate(template(page.template), pageContext(locale, page, site))
      expect(html).not.toContain('{{')
      expect(html).toContain(`<html lang="${locale}">`)
    }
})

test('a missing text is an error, not an empty string', () => {
  expect(() => renderTemplate('{{ t.nope }}', pageContext('en', pages[0], site))).toThrow('t.nope')
})

test('English lives at the root, French under /fr/, each page links to the other language', () => {
  const [home, installation] = pages
  expect(pageUrl('en', home)).toBe('/')
  expect(pageFile('fr', installation)).toBe('fr/installation/index.html')
  expect(pageContext('fr', installation, site).switch).toEqual({
    href: '/installation/',
    lang: 'en',
    code: 'EN',
    name: 'English',
  })
})

test('the language switch wins over the browser, the browser over the English default', () => {
  expect(preferredLocale({ chosen: 'en', languages: ['fr-FR'] })).toBe('en')
  expect(preferredLocale({ chosen: undefined, languages: ['de-DE', 'fr-CA', 'en'] })).toBe('fr')
  expect(preferredLocale({ chosen: undefined, languages: ['de-DE'] })).toBe('en')
})
