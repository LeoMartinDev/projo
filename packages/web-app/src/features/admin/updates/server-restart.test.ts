import { expect, test } from 'bun:test'

import { followServerRestart, type ServerRestartDeps } from './server-restart.ts'

const world = (answers: readonly (string | undefined)[], stopAfter = Infinity) => {
  const calls: string[] = []
  let looks = 0
  const deps: ServerRestartDeps = {
    from: '1.26.0',
    readVersion: async () => {
      const answer = answers[Math.min(looks, answers.length - 1)]
      looks += 1
      calls.push(`health ${answer ?? 'down'}`)
      return answer
    },
    wait: async () => undefined,
    stopped: () => looks >= stopAfter,
    reloadToLatest: async () => {
      calls.push('reloadToLatest')
    },
    refresh: async () => {
      calls.push('refresh')
    },
  }
  return { deps, calls }
}

test('a server back on a new version reloads on the latest app, then refreshes the page', async () => {
  const { deps, calls } = world(['1.26.0', '1.27.0'])
  await followServerRestart(deps)
  expect(calls).toEqual(['health 1.26.0', 'health 1.27.0', 'reloadToLatest', 'refresh'])
})

test('a server seen down then back is restarted, even on the same version', async () => {
  const { deps, calls } = world([undefined, '1.26.0'])
  await followServerRestart(deps)
  expect(calls).toEqual(['health down', 'health 1.26.0', 'reloadToLatest', 'refresh'])
})

test('a server still up on its old version is not restarted yet', async () => {
  const { deps, calls } = world(['1.26.0'], 3)
  await followServerRestart(deps)
  expect(calls).toEqual(['health 1.26.0', 'health 1.26.0', 'health 1.26.0'])
})

test('a page that stopped watching neither reloads nor refreshes', async () => {
  const { deps, calls } = world([undefined, '1.27.0'], 2)
  await followServerRestart(deps)
  expect(calls).toEqual(['health down', 'health 1.27.0'])
})
