// The site is rendered at build time, once per language: real static pages (no client-side
// translation), English at the root and French under /fr/. Templates live in src/pages/ and
// use {{ dotted.path }} placeholders, filled from the page context below.
import { type PhotoName, photoSources, photos } from '../photos.ts'
import { type Release } from '../releases/releases.ts'
import { releaseAnchor, renderChangelog } from '../releases/render.ts'
import { en, fr, type Messages } from './messages.ts'

export const locales = ['en', 'fr'] as const
export type Locale = (typeof locales)[number]

const messages: Record<Locale, Messages> = { en, fr }

// Where each language lives, and how its switch link is labelled.
const base: Record<Locale, string> = { en: '/', fr: '/fr/' }
const languageName: Record<Locale, string> = { en: 'English', fr: 'Français' }

export const pages = [
  { template: 'home.html', path: '' },
  { template: 'installation.html', path: 'installation/' },
  { template: 'changelog.html', path: 'changelog/' },
] as const
export type Page = (typeof pages)[number]

/** What the pages show beyond their texts, read once per build. */
export type Site = {
  /** Published releases, newest first (GitHub). */
  releases: readonly Release[]
  /** Shown when the releases could not be read (dev without network): the root package.json's. */
  fallbackVersion: string
}

/** URL path of a page in a language: '/', '/installation/', '/fr/', '/fr/installation/'. */
export const pageUrl = (locale: Locale, page: Page) => `${base[locale]}${page.path}`

/** Where the site is published: canonical, hreflang and sitemap URLs are absolute. */
export const origin = 'https://getprojo.com'
const absoluteUrl = (locale: Locale, page: Page) => `${origin}${pageUrl(locale, page)}`

/** sitemap.xml: every page in every language, each listing its translations. */
export const renderSitemap = () => {
  const alternates = (page: Page) =>
    locales
      .map(
        (locale) =>
          `    <xhtml:link rel="alternate" hreflang="${locale}" href="${absoluteUrl(locale, page)}"/>`,
      )
      .join('\n')
  const urls = locales.flatMap((locale) =>
    pages.map(
      (page) => `  <url>
    <loc>${absoluteUrl(locale, page)}</loc>
${alternates(page)}
  </url>`,
    ),
  )
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${urls.join('\n')}
</urlset>
`
}

/** Output file of a page in a language, relative to the app root: 'fr/index.html'… */
export const pageFile = (locale: Locale, page: Page) =>
  `${pageUrl(locale, page).slice(1)}index.html`

export const pageContext = (locale: Locale, page: Page, site: Site) => {
  const other: Locale = locale === 'en' ? 'fr' : 'en'
  const t = messages[locale]
  const version = site.releases[0]?.version ?? site.fallbackVersion
  const changelog = `${base[locale]}changelog/`
  return {
    t,
    lang: locale,
    base: base[locale],
    url: {
      en: absoluteUrl('en', page),
      fr: absoluteUrl('fr', page),
      self: absoluteUrl(locale, page),
    },
    home: base[locale],
    installation: `${base[locale]}installation/`,
    changelog,
    version: {
      number: version,
      short: version.split('.').slice(0, 2).join('.'),
      url: `${changelog}#${releaseAnchor(version)}`,
    },
    photo: Object.fromEntries(
      Object.keys(photos).map((name) => [name, photoSources(name as PhotoName)]),
    ),
    releases: renderChangelog(site.releases, {
      locale,
      labels: { latest: t.changelog.latest, github: t.changelog.github, empty: t.changelog.empty },
    }),
    switch: {
      href: pageUrl(other, page),
      lang: other,
      code: other.toUpperCase(),
      name: languageName[other],
    },
  }
}

const lookup = (context: unknown, path: string): unknown =>
  path
    .split('.')
    .reduce<unknown>(
      (value, key) =>
        value instanceof Object && key in value
          ? (value as Record<string, unknown>)[key]
          : undefined,
      context,
    )

/** Fills every {{ path }} of a template. A path that leads to no string is a bug: it throws. */
export const renderTemplate = (template: string, context: unknown) =>
  template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, path: string) => {
    const value = lookup(context, path)
    if (typeof value !== 'string') throw new Error(`www: no text for {{ ${path} }}`)
    return value
  })
