import { describe, expect, test } from 'bun:test'

import type { SourceSnapshot } from '../source/source.ts'
import { planExternalSubtitles, planStacks } from './sync.ts'

const snapshot = (
  id: string,
  relativePath: string,
  overrides: Partial<SourceSnapshot> = {},
): SourceSnapshot => ({
  id,
  libraryId: 'lib',
  rootId: 'root',
  relativePath,
  state: 'ready',
  sizeBytes: 1,
  mtimeMs: 1,
  classification: 'movie',
  parsed: {},
  matchState: 'unmatched',
  ...overrides,
})

describe('planStacks (§7.7)', () => {
  const cd = (id: string, index: number, overrides: Partial<SourceSnapshot> = {}) =>
    snapshot(id, `Film (2010)/Film (2010) - cd${index}.mkv`, {
      parsed: { title: 'Film', year: 2010, part: { index, label: `CD${index}` } },
      ...overrides,
    })

  test('groups the parts of one folder, then leaves a group that lost a member', () => {
    const changes = planStacks([cd('b', 2), cd('a', 1), snapshot('x', 'Other.mkv')])
    expect(changes).toEqual([
      { id: 'b', patch: { stackGroupId: 'root|Film (2010)|film|2010|', partIndex: 2 } },
      { id: 'a', patch: { stackGroupId: 'root|Film (2010)|film|2010|', partIndex: 1 } },
    ])
    const grouped = { stackGroupId: 'root|Film (2010)|film|2010|' }
    expect(
      planStacks([
        cd('a', 1, { ...grouped, partIndex: 1 }),
        cd('b', 2, { ...grouped, partIndex: 2 }),
      ]),
    ).toEqual([])
    expect(planStacks([cd('a', 1, { ...grouped, partIndex: 1 })])).toEqual([
      { id: 'a', patch: { stackGroupId: undefined, partIndex: undefined } },
    ])
    // A missing part keeps its group for when it comes back.
    expect(
      planStacks([
        cd('a', 1, { ...grouped, partIndex: 1 }),
        cd('b', 2, { ...grouped, partIndex: 2, state: 'missing' }),
      ]),
    ).toEqual([{ id: 'a', patch: { stackGroupId: undefined, partIndex: undefined } }])
  })
})

describe('planExternalSubtitles (§8.3)', () => {
  test('attaches same-name files and Subs/ content, only replacing what changed', () => {
    const sources = [
      snapshot('v', 'Film/Film.mkv'),
      snapshot('gone', 'Gone.mkv', { state: 'missing' }),
    ]
    const subtitlePaths = ['Film/Film.fr.srt', 'Film/Subs/English.srt', 'Orphan.srt']
    const changes = planExternalSubtitles({
      rootPath: '/media',
      sources,
      subtitlePaths,
      current: new Map(),
    })
    expect(changes).toEqual([
      {
        sourceId: 'v',
        rows: [
          {
            path: '/media/Film/Film.fr.srt',
            language: 'fr',
            forced: false,
            sdh: false,
            isDefault: false,
            format: 'srt',
          },
          {
            path: '/media/Film/Subs/English.srt',
            language: 'en',
            forced: false,
            sdh: false,
            isDefault: false,
            format: 'srt',
          },
        ],
      },
    ])
    const current = new Map([['v', changes[0]?.rows ?? []]])
    expect(planExternalSubtitles({ rootPath: '/media', sources, subtitlePaths, current })).toEqual(
      [],
    )
    expect(
      planExternalSubtitles({ rootPath: '/media', sources, subtitlePaths: [], current }),
    ).toEqual([{ sourceId: 'v', rows: [] }])
  })
})
