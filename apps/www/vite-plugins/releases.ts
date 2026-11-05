import { REPOSITORY, toReleases, type Release } from '../src/releases/releases.ts'

// Reads the published releases from the GitHub API, once per build or dev server start.
// GITHUB_TOKEN (optional) lifts the anonymous rate limit. A build fails when GitHub cannot be
// reached (a site without its changelog must not ship); the dev server warns and goes on.
export const loadReleases = async ({ strict }: { strict: boolean }): Promise<Release[]> => {
  const token = process.env['GITHUB_TOKEN']
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'projo-www-build',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }
  try {
    const all: unknown[] = []
    for (let page = 1; page <= 20; page++) {
      const response = await fetch(
        `https://api.github.com/repos/${REPOSITORY}/releases?per_page=100&page=${page}`,
        { headers },
      )
      if (!response.ok) throw new Error(`GitHub answered ${response.status}`)
      const batch: unknown = await response.json()
      if (!Array.isArray(batch)) throw new Error('GitHub did not answer a list of releases')
      all.push(...batch)
      if (batch.length < 100) break
    }
    return toReleases(all)
  } catch (error) {
    const message = `www: cannot read the releases of ${REPOSITORY} (${String(error)})`
    if (strict) throw new Error(message, { cause: error })
    console.warn(`${message}; the changelog page will be empty`)
    return []
  }
}
