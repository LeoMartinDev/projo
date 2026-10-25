import { describe, expect, test } from 'bun:test'
import { constants, getPriority } from 'node:os'

import { lowerProcessPriority, type ProcessPriority, runProcess } from './process.ts'

/** A Bun child that prints its own CPU priority (after a pause, so the spawn has returned). */
const childPriority = async (priority?: ProcessPriority): Promise<number> => {
  const run = await runProcess({
    command: process.execPath,
    args: ['-e', "await Bun.sleep(200); console.log(require('node:os').getPriority())"],
    timeoutMs: 30_000,
    ...(priority === undefined ? {} : { priority }),
  })
  if (!run.ok) throw new Error(run.error.message)
  expect(run.value.exitCode).toBe(0)
  return Number.parseInt(run.value.stdout.trim(), 10)
}

describe('runProcess priority', () => {
  test('background runs the binary at the lowest CPU priority (nice 19, idle on Windows)', async () => {
    expect(await childPriority('background')).toBe(constants.priority.PRIORITY_LOW)
  })

  test('normal (the default) keeps the priority of the server', async () => {
    expect(await childPriority()).toBe(getPriority())
    expect(await childPriority('normal')).toBe(getPriority())
  })

  test('a process that does not exist is reported, never thrown', () => {
    // Above Linux's `pid_max` (2^22) and any Windows process id in practice.
    expect(lowerProcessPriority(0x7fffffff)).toBe(false)
  })
})
