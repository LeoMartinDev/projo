import {
  RELEASE_CHECKSUMS_NAME,
  RELEASE_MANIFEST_NAME,
  releaseArchiveName,
  RELEASES_REPOSITORY,
} from '../../src/core/updates/update.ts'

const sha256 = (data: Uint8Array | string): string => {
  const hasher = new Bun.CryptoHasher('sha256')
  hasher.update(data)
  return hasher.digest('hex')
}

export type TestRelease = {
  version: string
  runtimeMin: string
  notes: string
  files: Map<string, Uint8Array>
  bundle: Record<string, string>
}

export type TestReleaseOptions = {
  version: string
  runtimeMin?: string
  notes?: string
  badArchiveChecksum?: boolean
  corruptFile?: string
  extraEntries?: Record<string, string>
  omit?: string[]
}

export const buildTestRelease = async (options: TestReleaseOptions): Promise<TestRelease> => {
  const { version, runtimeMin = '0.1.0', notes = `Notes of ${version}` } = options
  const bundle: Record<string, string> = {
    'server.js': `console.log('projo ${version}')\n`,
    'public/index.html': `<!doctype html><title>projo ${version}</title>`,
    'drizzle/meta/_journal.json': '{"entries":[]}',
  }
  const manifest = {
    version,
    runtimeMin,
    builtAt: '2026-10-24T00:00:00.000Z',
    files: Object.fromEntries(Object.entries(bundle).map(([path, data]) => [path, sha256(data)])),
  }
  const manifestJson = JSON.stringify(manifest, undefined, 2)
  const entries: Record<string, string> = {
    ...bundle,
    ...(options.corruptFile === undefined ? {} : { [options.corruptFile]: 'tampered' }),
    ...options.extraEntries,
    [RELEASE_MANIFEST_NAME]: manifestJson,
  }
  const archive = await new Bun.Archive(entries, { compress: 'gzip' }).bytes()
  const archiveName = releaseArchiveName(version)
  const sums = [
    `${options.badArchiveChecksum === true ? sha256('something else') : sha256(archive)}  ${archiveName}`,
    `${sha256(manifestJson)}  ${RELEASE_MANIFEST_NAME}`,
    '',
  ].join('\n')
  const files = new Map<string, Uint8Array>([
    [archiveName, archive],
    [RELEASE_CHECKSUMS_NAME, new TextEncoder().encode(sums)],
    [RELEASE_MANIFEST_NAME, new TextEncoder().encode(manifestJson)],
  ])
  for (const name of options.omit ?? []) files.delete(name)
  return { version, runtimeMin, notes, files, bundle: { ...bundle, 'manifest.json': manifestJson } }
}

export const startGithubReleasesServer = () => {
  let release: TestRelease | undefined
  const requests: string[] = []
  const server = Bun.serve({
    port: 0,
    fetch: (request) => {
      const url = new URL(request.url)
      requests.push(url.pathname)
      if (url.pathname === `/repos/${RELEASES_REPOSITORY}/releases/latest`) {
        if (release === undefined) return Response.json({ message: 'Not Found' }, { status: 404 })
        const tag = `v${release.version}`
        return Response.json({
          tag_name: tag,
          name: tag,
          html_url: `https://github.com/${RELEASES_REPOSITORY}/releases/tag/${tag}`,
          body: release.notes,
          draft: false,
          prerelease: false,
          created_at: '2026-10-24T08:00:00Z',
          published_at: '2026-10-24T09:00:00Z',
          assets: [...release.files].map(([name, bytes]) => ({
            name,
            size: bytes.byteLength,
            browser_download_url: `${url.origin}/download/${tag}/${name}`,
          })),
        })
      }
      const match = /^\/download\/v([^/]+)\/([^/]+)$/u.exec(url.pathname)
      const bytes =
        match && release !== undefined && match[1] === release.version
          ? release.files.get(match[2] ?? '')
          : undefined
      return bytes === undefined
        ? new Response('Not Found', { status: 404 })
        : new Response(bytes, { headers: { 'content-type': 'application/octet-stream' } })
    },
  })
  const origin = `http://127.0.0.1:${server.port}`
  return {
    apiBaseUrl: origin,
    downloadPrefix: `${origin}/download/`,
    publish: (next: TestRelease | undefined) => {
      release = next
    },
    requests,
    stop: () => server.stop(true),
  }
}
