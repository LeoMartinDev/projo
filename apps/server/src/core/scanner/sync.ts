import { joinAbsolute } from '../library/roots.ts'
import { matchExternalSubtitles, resolveStacks } from '../naming/index.ts'
import type { ExternalSubtitleRow, SourcePatch, SourceSnapshot } from '../source/source.ts'

const isPresent = (source: SourceSnapshot): boolean =>
  source.state !== 'missing' && source.state !== 'rejected'

/**
 * §7.7 parts: files of one folder with a part token and the same title share a
 * `stack_group_id` (root id + the deterministic group key), ordered by `part_index`.
 */
export const planStacks = (
  snapshots: readonly SourceSnapshot[],
): { id: string; patch: SourcePatch }[] => {
  const byRoot = new Map<string, SourceSnapshot[]>()
  for (const source of snapshots.filter(isPresent)) {
    const sources = byRoot.get(source.rootId)
    if (sources === undefined) byRoot.set(source.rootId, [source])
    else sources.push(source)
  }
  const desired = new Map<string, { stackGroupId: string; partIndex: number }>()
  for (const [rootId, sources] of byRoot) {
    const { stacks } = resolveStacks(
      sources
        .filter((s) => s.parsed.part !== undefined)
        .map((s) => ({ key: s.id, relativePath: s.relativePath, parsed: s.parsed })),
    )
    for (const stack of stacks) {
      for (const member of stack.members) {
        desired.set(member.key, {
          stackGroupId: `${rootId}|${stack.groupKey}`,
          partIndex: member.partIndex,
        })
      }
    }
  }
  return snapshots.flatMap((source): { id: string; patch: SourcePatch }[] => {
    const want = isPresent(source) ? desired.get(source.id) : undefined
    if (want === undefined) {
      // A missing part keeps its group: it comes back as it was.
      if (!isPresent(source) || source.stackGroupId === undefined) return []
      return [{ id: source.id, patch: { stackGroupId: undefined, partIndex: undefined } }]
    }
    if (source.stackGroupId === want.stackGroupId && source.partIndex === want.partIndex) return []
    return [{ id: source.id, patch: want }]
  })
}

const rowKey = (row: ExternalSubtitleRow): string =>
  JSON.stringify([
    row.path,
    row.language,
    row.forced,
    row.sdh,
    row.isDefault,
    row.format,
    row.title,
  ])

const sameRows = (
  a: readonly ExternalSubtitleRow[],
  b: readonly ExternalSubtitleRow[],
): boolean => {
  if (a.length !== b.length) return false
  const keys = new Set(a.map(rowKey))
  return b.every((row) => keys.has(rowKey(row)))
}

/**
 * §8.3 external subtitles of one root: what each present source should have in
 * `source_subtitles` (`kind = external`), as replacements for the sources that differ.
 */
export const planExternalSubtitles = ({
  rootPath,
  sources,
  subtitlePaths,
  current,
}: {
  rootPath: string
  /** Present video sources of the root. */
  sources: readonly SourceSnapshot[]
  subtitlePaths: readonly string[]
  current: ReadonlyMap<string, readonly ExternalSubtitleRow[]>
}): { sourceId: string; rows: ExternalSubtitleRow[] }[] => {
  const present = sources.filter(isPresent)
  const idByPath = new Map(present.map((s) => [s.relativePath.normalize('NFC'), s.id]))
  const matched = matchExternalSubtitles({
    videoPaths: present.map((s) => s.relativePath),
    subtitlePaths,
  })
  // The matcher works on NFC; the disk keeps its own bytes (Linux file names may be NFD).
  const onDisk = new Map(subtitlePaths.map((path) => [path.normalize('NFC'), path]))
  const wanted = new Map<string, ExternalSubtitleRow[]>()
  for (const subtitle of matched) {
    const sourceId = idByPath.get(subtitle.videoPath)
    if (sourceId === undefined) continue
    const row: ExternalSubtitleRow = {
      path: joinAbsolute(rootPath, onDisk.get(subtitle.subtitlePath) ?? subtitle.subtitlePath),
      forced: subtitle.forced,
      sdh: subtitle.sdh,
      isDefault: subtitle.isDefault,
      format: subtitle.format,
      ...(subtitle.language === undefined ? {} : { language: subtitle.language }),
      ...(subtitle.title === undefined ? {} : { title: subtitle.title }),
    }
    wanted.set(sourceId, [...(wanted.get(sourceId) ?? []), row])
  }
  return present.flatMap((source) => {
    const want = wanted.get(source.id) ?? []
    const have = current.get(source.id) ?? []
    return sameRows(want, have) ? [] : [{ sourceId: source.id, rows: want }]
  })
}
