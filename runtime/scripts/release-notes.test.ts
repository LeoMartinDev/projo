import { describe, expect, test } from 'bun:test'
import { parseCommit, readCommits, renderReleaseNotes, type Commit } from './release-notes'

const commit = (subject: string, body = '', hash = 'abcdef0123456789'): Commit => ({
  hash,
  subject,
  body,
})

describe('parseCommit', () => {
  test('reads type, scope, breaking mark and description', () => {
    expect(parseCommit(commit('feat(updates): mises à jour depuis l’admin'))).toEqual({
      hash: 'abcdef0123456789',
      type: 'feat',
      scope: 'updates',
      breaking: false,
      description: 'mises à jour depuis l’admin',
    })
    expect(parseCommit(commit('fix!: chemin des données'))).toMatchObject({
      type: 'fix',
      breaking: true,
    })
    expect(
      parseCommit(commit('refactor: x', 'BREAKING CHANGE: DATA_DIR obligatoire')),
    ).toMatchObject({ type: 'refactor', breaking: true })
  })

  test('keeps a non-conventional subject as is', () => {
    expect(parseCommit(commit('Merge something odd'))).toEqual({
      hash: 'abcdef0123456789',
      type: 'other',
      breaking: false,
      description: 'Merge something odd',
    })
  })
})

describe('renderReleaseNotes', () => {
  test('groups the commits by type, newest first, with the runtime and the compare link', () => {
    const notes = renderReleaseNotes({
      version: '1.1.0',
      previousTag: 'v1.0.0',
      runtimeMin: '0.2.0',
      runtimeImage: 'ghcr.io/leomartindev/projo:0.2.0',
      commits: [
        commit('chore(release): 1.1.0', '', '9999999aaaa'),
        commit('perf(web): fewer renders', '', '5555555aaaa'),
        commit('docs: README', '', '4444444aaaa'),
        commit('fix(jobs): clean resume', '', '3333333aaaa'),
        commit('feat(admin)!: new dashboard', '', '2222222aaaa'),
        commit('feat: database export', '', '1111111aaaa'),
      ],
    })
    expect(notes).toBe(
      [
        '## Breaking changes',
        '',
        '- admin: new dashboard (2222222)',
        '',
        '## Features',
        '',
        '- admin: new dashboard (2222222)',
        '- database export (1111111)',
        '',
        '## Fixes',
        '',
        '- jobs: clean resume (3333333)',
        '',
        '## Performance',
        '',
        '- web: fewer renders (5555555)',
        '',
        '## Other changes',
        '',
        '- README (4444444)',
        '',
        'New runtime image ghcr.io/leomartindev/projo:0.2.0: update the container (docker compose pull, then docker compose up -d).',
        '',
        'Minimum runtime: 0.2.0.',
        '',
        'Changes: https://github.com/LeoMartinDev/projo/compare/v1.0.0...v1.1.0',
        '',
      ].join('\n'),
    )
  })

  test('first release: the whole history, no compare link', () => {
    const notes = renderReleaseNotes({ version: '1.0.0', commits: [] })
    expect(notes).toBe(
      'No notable changes.\n\nHistory: https://github.com/LeoMartinDev/projo/commits/v1.0.0\n',
    )
  })
})

describe('readCommits', () => {
  // The CI runs the tests in the runtime image, which has no git (the release job has it).
  test.skipIf(!Bun.which('git'))('reads subjects and bodies from git log', () => {
    const [head] = readCommits('HEAD')
    expect(head?.hash).toMatch(/^[0-9a-f]{40}$/u)
    expect(head?.subject.length).toBeGreaterThan(0)
  })
})
