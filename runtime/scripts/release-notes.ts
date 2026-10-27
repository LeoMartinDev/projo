// Release notes from the Conventional Commits since the previous release (PRODUCT.md §22).
// Plain text that reads as Markdown: GitHub renders it, and so does the admin for this subset
// (`## ` headings, `- ` lists, paragraphs, `code`, https links: features/admin/updates/release-notes.ts).
// Usage: bun runtime/scripts/release-notes.ts --tag vX.Y.Z [--from vA.B.C] [--manifest dist/release/manifest.json]
//          [--runtime-image ghcr.io/leomartindev/projo:A.B.C]
import { parseArgs } from 'node:util'
import { readManifest } from '../supervisor/manifest'
import { dirname } from 'node:path'

export const REPOSITORY = 'LeoMartinDev/projo'

export type Commit = { hash: string; subject: string; body: string }

export type ParsedCommit = {
  hash: string
  type: string
  scope?: string
  breaking: boolean
  description: string
}

const HEADER = /^(?<type>[a-z]+)(?:\((?<scope>[^()]+)\))?(?<bang>!)?: (?<description>.+)$/u

/** `type(scope)!: description`; anything else is kept as an `other` entry with its subject. */
export const parseCommit = ({ hash, subject, body }: Commit): ParsedCommit => {
  const match = HEADER.exec(subject.trim())
  const groups = match?.groups
  if (groups === undefined || groups.type === undefined || groups.description === undefined)
    return { hash, type: 'other', breaking: false, description: subject.trim() }
  return {
    hash,
    type: groups.type,
    ...(groups.scope === undefined ? {} : { scope: groups.scope }),
    breaking: groups.bang === '!' || /^BREAKING[ -]CHANGE: /mu.test(body),
    description: groups.description.trim(),
  }
}

/** Sections in display order; types not listed here land in "Other changes". */
const SECTIONS: ReadonlyArray<{ title: string; types: readonly string[] }> = [
  { title: 'Features', types: ['feat'] },
  { title: 'Fixes', types: ['fix'] },
  { title: 'Performance', types: ['perf'] },
]
const OTHER_TITLE = 'Other changes'
const BREAKING_TITLE = 'Breaking changes'
/** Release commits (`chore(release): 1.2.0`) say nothing the notes do not already say. */
const isReleaseCommit = (commit: ParsedCommit) =>
  commit.type === 'chore' && commit.scope === 'release'

const line = (commit: ParsedCommit): string =>
  `- ${commit.scope === undefined ? '' : `${commit.scope}: `}${commit.description} (${commit.hash.slice(0, 7)})`

export type ReleaseNotesInput = {
  version: string
  previousTag?: string
  /** Newest first, as `git log` prints them. */
  commits: readonly Commit[]
  runtimeMin?: string
  /** The runtime image published with this release, when there is one. */
  runtimeImage?: string
}

export const renderReleaseNotes = ({
  version,
  previousTag,
  commits,
  runtimeMin,
  runtimeImage,
}: ReleaseNotesInput): string => {
  const parsed = commits.map(parseCommit).filter((commit) => !isReleaseCommit(commit))
  const blocks: string[] = []
  const section = (title: string, entries: readonly ParsedCommit[]) => {
    if (entries.length > 0) blocks.push([`## ${title}`, '', ...entries.map(line)].join('\n'))
  }
  section(
    BREAKING_TITLE,
    parsed.filter((commit) => commit.breaking),
  )
  for (const { title, types } of SECTIONS)
    section(
      title,
      parsed.filter((commit) => types.includes(commit.type)),
    )
  const known = new Set(SECTIONS.flatMap((s) => s.types))
  section(
    OTHER_TITLE,
    parsed.filter((commit) => !known.has(commit.type)),
  )
  if (blocks.length === 0) blocks.push('No notable changes.')

  const footer: string[] = []
  if (runtimeImage !== undefined) {
    footer.push(
      `New runtime image ${runtimeImage}: update the container (docker compose pull, then docker compose up -d).`,
    )
  }
  if (runtimeMin !== undefined) footer.push(`Minimum runtime: ${runtimeMin}.`)
  footer.push(
    previousTag === undefined
      ? `History: https://github.com/${REPOSITORY}/commits/v${version}`
      : `Changes: https://github.com/${REPOSITORY}/compare/${previousTag}...v${version}`,
  )
  return `${[...blocks, footer.join('\n\n')].join('\n\n')}\n`
}

const FIELD = '\u001f'
const RECORD = '\u001e'

/** `git log <from>..<to>` without merges, newest first. */
export const readCommits = (to: string, from?: string): Commit[] => {
  const range = from === undefined ? to : `${from}..${to}`
  const run = Bun.spawnSync([
    'git',
    'log',
    '--no-merges',
    `--format=%H${FIELD}%s${FIELD}%b${RECORD}`,
    range,
  ])
  if (run.exitCode !== 0) throw new Error(`git log ${range} failed: ${run.stderr.toString()}`)
  return run.stdout
    .toString()
    .split(RECORD)
    .map((record) => record.replace(/^\s+/u, ''))
    .filter((record) => record !== '')
    .map((record) => {
      const [hash = '', subject = '', body = ''] = record.split(FIELD)
      return { hash, subject, body }
    })
}

if (import.meta.main) {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      tag: { type: 'string' },
      from: { type: 'string' },
      manifest: { type: 'string' },
      'runtime-image': { type: 'string' },
    },
  })
  const tag = values.tag
  if (tag === undefined || !/^v\d+\.\d+\.\d+$/u.test(tag)) {
    console.error('release-notes: --tag vX.Y.Z is required')
    process.exit(1)
  }
  // An empty --from (first release, no previous tag) means the whole history.
  const from = values.from || undefined
  let runtimeMin: string | undefined
  if (values.manifest !== undefined) {
    const manifest = await readManifest(dirname(values.manifest))
    if (!manifest.ok) {
      console.error(`release-notes: ${manifest.error.message}`)
      process.exit(1)
    }
    runtimeMin = manifest.value.runtimeMin
  }
  const runtimeImage = values['runtime-image'] || undefined
  process.stdout.write(
    renderReleaseNotes({
      version: tag.slice(1),
      commits: readCommits(tag, from),
      ...(from === undefined ? {} : { previousTag: from }),
      ...(runtimeMin === undefined ? {} : { runtimeMin }),
      ...(runtimeImage === undefined ? {} : { runtimeImage }),
    }),
  )
}
