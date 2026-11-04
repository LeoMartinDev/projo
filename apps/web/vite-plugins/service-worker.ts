import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'

import { build, type Plugin } from 'vite'

const entry = fileURLToPath(new URL('../src/service-worker/sw.ts', import.meta.url))

export const precacheEntries = (fileNames: ReadonlyArray<string>): string[] =>
  fileNames
    .filter((name) => !name.endsWith('.map') && name !== 'sw.js')
    .map((name) => `/${name}`)
    .toSorted()

export const cacheNameOf = ({
  version,
  files,
}: {
  version: string
  files: ReadonlyArray<{ name: string; source: string | Uint8Array }>
}): string => {
  const hash = createHash('sha256')
  for (const { name, source } of files.toSorted((a, b) => a.name.localeCompare(b.name)))
    hash.update(name).update('\0').update(source).update('\0')
  return `projo-${version}-${hash.digest('hex').slice(0, 12)}`
}

const bundleServiceWorker = async (define: Record<string, string>): Promise<string> => {
  const output = await build({
    configFile: false,
    publicDir: false,
    logLevel: 'warn',
    define,
    build: {
      write: false,
      emptyOutDir: false,
      sourcemap: false,
      minify: true,
      lib: { entry, formats: ['iife'], name: 'projoServiceWorker', fileName: () => 'sw.js' },
    },
  })
  const results = Array.isArray(output) ? output : [output]
  for (const result of results)
    if ('output' in result)
      for (const file of result.output) if (file.type === 'chunk') return file.code
  throw new Error('service worker bundle produced no chunk')
}

export const serviceWorkerPlugin = ({ version }: { version: string }): Plugin => ({
  name: 'projo:service-worker',
  apply: 'build',
  enforce: 'post',
  transformIndexHtml: () => [
    { tag: 'meta', attrs: { name: 'projo-version', content: version }, injectTo: 'head' },
  ],
  async generateBundle(_options, bundle) {
    const files = Object.values(bundle)
      .filter((file) => !file.fileName.endsWith('.map'))
      .map((file) => ({
        name: file.fileName,
        source: file.type === 'chunk' ? file.code : file.source,
      }))
    const precache = precacheEntries(files.map((file) => file.name))
    const code = await bundleServiceWorker({
      __PRECACHE__: JSON.stringify(precache),
      __CACHE_NAME__: JSON.stringify(cacheNameOf({ version, files })),
    })
    this.emitFile({ type: 'asset', fileName: 'sw.js', source: code })
  },
})
