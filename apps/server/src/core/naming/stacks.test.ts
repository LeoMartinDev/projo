import { describe, expect, test } from 'bun:test'

import { analyzeMediaPath } from './analyze'
import { resolveStacks } from './stacks'

const candidates = (paths: readonly string[]) =>
  paths.map((relativePath) => ({
    key: relativePath,
    relativePath,
    parsed: analyzeMediaPath({ relativePath, hint: 'auto' }).parsed,
  }))

describe('resolveStacks (§7.7 parties)', () => {
  test('cd1/cd2 du même dossier : un groupe ordonné', () => {
    const { stacks, unstacked } = resolveStacks(
      candidates(['Heat/Heat-cd2.avi', 'Heat/Heat-cd1.avi', 'Heat/Heat.nfo.mkv']),
    )
    expect(stacks).toEqual([
      {
        groupKey: 'Heat|heat||',
        title: 'Heat',
        members: [
          { key: 'Heat/Heat-cd1.avi', partIndex: 1 },
          { key: 'Heat/Heat-cd2.avi', partIndex: 2 },
        ],
      },
    ])
    expect(unstacked).toEqual([])
  })

  test('lettres a-d', () => {
    const { stacks } = resolveStacks(
      candidates(['Film (2010) - part b.mkv', 'Film (2010) - part a.mkv']),
    )
    expect(stacks[0]?.members.map((m) => m.partIndex)).toEqual([1, 2])
  })

  test('dossiers différents : pas de groupe', () => {
    const { stacks, unstacked } = resolveStacks(candidates(['A/Heat-cd1.avi', 'B/Heat-cd2.avi']))
    expect(stacks).toEqual([])
    expect(unstacked).toEqual([
      { key: 'A/Heat-cd1.avi', title: 'Heat' },
      { key: 'B/Heat-cd2.avi', title: 'Heat' },
    ])
  })

  test('titres différents : pas de groupe', () => {
    expect(resolveStacks(candidates(['Heat-cd1.avi', 'Ronin-cd2.avi'])).stacks).toEqual([])
  })

  test('même numéro de partie deux fois (deux versions) : pas de groupe', () => {
    expect(resolveStacks(candidates(['Heat/Heat-cd1.avi', 'Heat/Heat-cd1.mkv'])).stacks).toEqual([])
  })

  // Ambiguity: a single file with `Part 1` is a title (`Deathly Hallows Part 1`), not a stack: the label is restored.
  test('partie seule : `Part N` rendu au titre, `CD N` reste retiré', () => {
    const { unstacked } = resolveStacks(
      candidates(['Harry Potter and the Deathly Hallows Part 1.mkv', 'Heat-cd1.avi']),
    )
    expect(unstacked).toEqual([
      {
        key: 'Harry Potter and the Deathly Hallows Part 1.mkv',
        title: 'Harry Potter and the Deathly Hallows Part 1',
      },
      { key: 'Heat-cd1.avi', title: 'Heat' },
    ])
  })

  test('sans partie : ignoré', () => {
    expect(resolveStacks(candidates(['Heat.mkv']))).toEqual({ stacks: [], unstacked: [] })
  })
})
