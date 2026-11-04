import { directoryOf } from './path'
import { normalizeTitle } from './title'
import type { ParsedName, PartInfo } from './types'

export type StackCandidate = {
  readonly key: string
  readonly relativePath: string
  readonly parsed: ParsedName
}

export type StackGroup = {
  readonly groupKey: string
  readonly title: string
  readonly members: readonly { readonly key: string; readonly partIndex: number }[]
}

export type StackResolution = {
  readonly stacks: readonly StackGroup[]
  readonly unstacked: readonly { readonly key: string; readonly title: string }[]
}

type WithPart = StackCandidate & {
  readonly title: string
  readonly part: NonNullable<ParsedName['part']>
}

const groupKeyOf = (candidate: WithPart): string =>
  [
    directoryOf(candidate.relativePath),
    normalizeTitle(candidate.title),
    candidate.parsed.year ?? '',
    candidate.parsed.edition ?? candidate.parsed.editionName ?? '',
  ].join('|')

export const unstackedTitle = (title: string, part: PartInfo): string =>
  /^(?:part|pt)\b/iu.test(part.label) ? `${title} ${part.label}` : title

const restoredTitle = (candidate: WithPart): string =>
  unstackedTitle(candidate.title, candidate.part)

export const resolveStacks = (candidates: readonly StackCandidate[]): StackResolution => {
  const withPart = candidates.flatMap((c): WithPart[] =>
    c.parsed.part === undefined || c.parsed.title === undefined
      ? []
      : [{ ...c, title: c.parsed.title, part: c.parsed.part }],
  )
  const groups = new Map<string, WithPart[]>()
  for (const candidate of withPart) {
    const key = groupKeyOf(candidate)
    groups.set(key, [...(groups.get(key) ?? []), candidate])
  }
  const entries = [...groups.entries()]
  const isStack = (members: readonly WithPart[]): boolean =>
    members.length >= 2 && new Set(members.map((m) => m.part.index)).size === members.length

  return {
    stacks: entries.flatMap(([groupKey, members]) => {
      const [first] = members
      if (first === undefined || !isStack(members)) return []
      const ordered = [...members].sort((a, b) => a.part.index - b.part.index)
      return [
        {
          groupKey,
          title: first.title,
          members: ordered.map((m) => ({ key: m.key, partIndex: m.part.index })),
        },
      ]
    }),
    unstacked: entries.flatMap(([, members]) =>
      isStack(members) ? [] : members.map((m) => ({ key: m.key, title: restoredTitle(m) })),
    ),
  }
}
