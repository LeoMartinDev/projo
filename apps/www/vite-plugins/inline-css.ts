import type { Plugin, Rollup } from 'vite'

// Build only: each page carries its stylesheet in a <style> (≈ 12 kB gzipped) instead of a
// render-blocking <link>, and preloads the sans font its first text is set in, so the first
// paint needs nothing but the HTML. The stylesheet's url()s are absolute (/assets/…), so they
// resolve the same from the page.
export const inlineCssPlugin = (): Plugin => ({
  name: 'projo-www-inline-css',
  apply: 'build',
  transformIndexHtml: {
    order: 'post',
    handler: (html, { bundle }) => {
      if (!bundle) return html
      const assets = Object.values(bundle).filter(
        (output): output is Rollup.OutputAsset => output.type === 'asset',
      )
      const font = assets.find((asset) => /\/geist-core-[\w-]+\.woff2$/.test(asset.fileName))
      const inlined = html.replace(
        /<link rel="stylesheet"[^>]*href="\/([^"]+\.css)"[^>]*>/g,
        (link, fileName: string) => {
          const css = assets.find((asset) => asset.fileName === fileName)?.source
          return typeof css === 'string' ? `<style>${css}</style>` : link
        },
      )
      if (!font) throw new Error('www: the Latin Geist font is missing from the bundle')
      return {
        html: inlined,
        tags: [
          {
            tag: 'link',
            attrs: {
              rel: 'preload',
              href: `/${font.fileName}`,
              as: 'font',
              type: 'font/woff2',
              crossorigin: '',
            },
            injectTo: 'head-prepend',
          },
        ],
      }
    },
  },
})
