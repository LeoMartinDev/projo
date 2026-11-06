import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { type Plugin } from 'vite'

import {
  locales,
  pageContext,
  pageFile,
  pages,
  pageUrl,
  renderSitemap,
  renderTemplate,
  type Site,
} from '../src/i18n/pages.ts'
import { loadReleases } from './releases.ts'

// Serves and builds every page in every language from src/pages/*.html. The HTML files do not
// exist on disk: the build gets them from load(), the dev server from a middleware. The
// releases (changelog page, version badge) are read once from GitHub when Vite starts.
export const pagesPlugin = (): Plugin => {
  let root = process.cwd()
  let site: Site = { releases: [], fallbackVersion: '0.0.0' }
  const templates = () => join(root, 'src', 'pages')

  const entries = () =>
    locales.flatMap((locale) =>
      pages.map((page) => ({
        name: `${locale}-${page.template.replace('.html', '')}`,
        file: resolve(root, pageFile(locale, page)),
        url: pageUrl(locale, page),
        render: () =>
          renderTemplate(
            readFileSync(join(templates(), page.template), 'utf8'),
            pageContext(locale, page, site),
          ),
      })),
    )

  const byFile = (id: string) =>
    entries().find((entry) => entry.file === resolve(id.split('?')[0] ?? id))

  return {
    name: 'projo-www-pages',
    enforce: 'pre',
    config: async (config, { command }) => {
      root = resolve(config.root ?? process.cwd())
      const rootPackage = JSON.parse(readFileSync(resolve(root, '../../package.json'), 'utf8')) as {
        version: string
      }
      site = {
        releases: await loadReleases({ strict: command === 'build' }),
        fallbackVersion: rootPackage.version,
      }
      return {
        build: {
          rollupOptions: {
            input: Object.fromEntries(entries().map((entry) => [entry.name, entry.file])),
          },
        },
      }
    },
    resolveId: (id) => byFile(id)?.file,
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'sitemap.xml', source: renderSitemap() })
    },
    load: (id) => byFile(id)?.render(),
    configureServer: (server) => {
      server.middlewares.use(async (request, response, next) => {
        const path = (request.url ?? '/').split('?')[0] ?? '/'
        const entry = entries().find(
          (candidate) => candidate.url === path || `${candidate.url}index.html` === path,
        )
        if (!entry) return next()
        try {
          const html = await server.transformIndexHtml(path, entry.render(), request.originalUrl)
          response.setHeader('Content-Type', 'text/html; charset=utf-8')
          response.end(html)
        } catch (error) {
          // A missing text while editing a template: shown by Vite, the dev server keeps running.
          next(error)
        }
      })
    },
    handleHotUpdate: ({ file, server }) => {
      if (file.replaceAll('\\', '/').startsWith(templates().replaceAll('\\', '/')))
        server.ws.send({ type: 'full-reload' })
    },
  }
}
