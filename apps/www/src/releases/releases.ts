import { z } from 'zod'

// The changelog page lists the GitHub releases (the published ones, with their publication
// date). Their notes are the ones runtime/scripts/release-notes.ts generated: "## Section"
// headings, "- scope: description (hash)" items and a few closing lines. Releases up to 1.6.3
// were generated in French: their headings and closing lines are put back in English here
// (the commit descriptions stay as they were written). The notes are always shown in English.

export const REPOSITORY = 'LeoMartinDev/projo'

export const githubReleasesSchema = z.array(
  z.object({
    tag_name: z.string(),
    published_at: z.string().nullable(),
    draft: z.boolean(),
    prerelease: z.boolean(),
    body: z.string().nullable(),
  }),
)

export type ReleaseItem = { scope?: string; text: string; hash?: string }
export type ReleaseSection = { title: string; items: ReleaseItem[] }
export type Release = {
  version: string
  publishedAt: Date
  sections: ReleaseSection[]
  notes: string[]
}

const sectionTitles: Record<string, string> = {
  Nouveautés: 'Features',
  Corrections: 'Fixes',
  Performances: 'Performance',
  'Autres changements': 'Other changes',
  'Changements incompatibles': 'Breaking changes',
}

// "scope: text" (English notes) or "scope : text" (the French ones, up to 1.6.3).
const ITEM = /^- (?:(?<scope>[\w./-]+) ?: )?(?<text>.+?)(?: \((?<hash>[0-9a-f]{7,40})\))?$/u

const englishNote = (line: string): string | undefined => {
  if (/^(Changes|Changements|History|Historique) ?:/u.test(line)) return undefined
  const minimum = /^Runtime minimal : (?<version>.+?)\.?$/u.exec(line)
  if (minimum?.groups?.['version'] !== undefined)
    return `Minimum runtime: ${minimum.groups['version']}.`
  const image = /^Nouvelle image runtime (?<image>\S+) : /u.exec(line)
  if (image?.groups?.['image'] !== undefined)
    return `New runtime image ${image.groups['image']}: update the container (docker compose pull, then docker compose up -d).`
  return line
}

export const parseReleaseNotes = (body: string): Pick<Release, 'sections' | 'notes'> => {
  const sections: ReleaseSection[] = []
  const notes: string[] = []
  for (const raw of body.split(/\r?\n/u)) {
    const line = raw.trim()
    if (line === '') continue
    const heading = /^##\s+(?<title>.+)$/u.exec(line)?.groups?.['title']
    if (heading !== undefined) {
      sections.push({ title: sectionTitles[heading] ?? heading, items: [] })
      continue
    }
    const item = ITEM.exec(line)?.groups
    const section = sections.at(-1)
    if (item?.['text'] !== undefined && section !== undefined) {
      section.items.push({
        text: item['text'],
        ...(item['scope'] === undefined ? {} : { scope: item['scope'] }),
        ...(item['hash'] === undefined ? {} : { hash: item['hash'] }),
      })
      continue
    }
    const note = englishNote(line)
    if (note !== undefined) notes.push(note)
  }
  return { sections, notes }
}

/** Published releases, newest first. */
export const toReleases = (response: unknown): Release[] =>
  githubReleasesSchema
    .parse(response)
    .filter((release) => !release.draft && !release.prerelease && release.published_at)
    .map((release) => ({
      version: release.tag_name.replace(/^v/u, ''),
      publishedAt: new Date(release.published_at ?? 0),
      ...parseReleaseNotes(release.body ?? ''),
    }))
    .sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime())
