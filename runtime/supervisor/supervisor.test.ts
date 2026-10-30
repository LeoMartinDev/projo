import { describe, expect, test } from 'bun:test'
import { supervisorError } from './errors'
import { defaultRestartPolicy } from './restart-policy'
import { err, ok } from './result'
import { supervisorFactory, SWITCH_EXIT_CODE, type SupervisorDeps } from './supervisor'
import { fakeLauncher, flush, manualClock, memoryLogger } from './test-support'
import type { InstalledVersion } from './version-state'

const app: InstalledVersion = {
  version: '1.2.0',
  dir: '/data/app/versions/1.2.0',
  entry: '/data/app/versions/1.2.0/server.js',
  manifest: {
    version: '1.2.0',
    runtimeMin: '0.1.0',
    builtAt: '2026-10-23T00:00:00.000Z',
    files: { 'server.js': 'a'.repeat(64) },
  },
}

const setup = (
  overrides: Partial<SupervisorDeps> = {},
  launcherOptions: { exitOnSignal?: boolean } = {},
  { switchTo }: { switchTo?: string } = {},
) => {
  const { clock, advance, pendingDelays } = manualClock()
  const { launch, children } = fakeLauncher(launcherOptions)
  const { logger, codes } = memoryLogger()
  const switches: string[] = []
  /** What the switch handler was asked, in order. */
  const switchCalls: string[] = []
  /** Resolves the pending `/health` wait (true: healthy). */
  let answerHealth: (healthy: boolean) => void = () => undefined
  const supervisor = supervisorFactory({
    prepareApp: async () => ok(app),
    launch,
    bunPath: '/usr/local/bin/bun',
    appEnv: { PORT: '8080', PROJO_RUNTIME_VERSION: '0.1.0' },
    switchHandler: {
      begin: async (from) => {
        switches.push(from.version)
        return switchTo === undefined ? undefined : { from: from.version, to: switchTo }
      },
      confirm: async ({ to }) => void switchCalls.push(`confirm ${to}`),
      rollback: async ({ to }, reason) => void switchCalls.push(`rollback ${to} ${reason}`),
    },
    waitForHealth: ({ signal }) =>
      new Promise((resolve) => {
        const unhealthy = err(supervisorError('health/unreachable', 'down'))
        answerHealth = (healthy) => resolve(healthy ? ok(undefined) : unhealthy)
        signal?.addEventListener('abort', () => resolve(unhealthy), { once: true })
      }),
    restartPolicy: defaultRestartPolicy,
    shutdownGraceMs: 25_000,
    clock,
    logger,
    ...overrides,
  })
  let exitCode: number | undefined
  const running = supervisor.run().then((code) => {
    exitCode = code
    return code
  })
  return {
    supervisor,
    children,
    advance,
    pendingDelays,
    codes,
    switches,
    switchCalls,
    answerHealth: (healthy: boolean) => answerHealth(healthy),
    running,
    exitCode: () => exitCode,
  }
}

const crash = { kind: 'code', code: 1 } as const

describe('supervisor', () => {
  test('launches the resolved version with bun, from its real directory', async () => {
    const { children } = setup()
    await flush()
    expect(children).toHaveLength(1)
    expect(children[0]?.spec).toEqual({
      command: '/usr/local/bin/bun',
      args: ['/data/app/versions/1.2.0/server.js'],
      cwd: '/data/app/versions/1.2.0',
      env: { PORT: '8080', PROJO_RUNTIME_VERSION: '0.1.0' },
    })
  })

  test('restarts a crashing app with 1 s, 5 s then 30 s backoff', async () => {
    const { children, advance, pendingDelays, codes } = setup()
    await flush()
    for (const [index, delay] of [1_000, 5_000, 30_000, 30_000].entries()) {
      await children[index]?.exit(crash)
      expect(pendingDelays()).toEqual([delay])
      await advance(delay - 1)
      expect(children).toHaveLength(index + 1)
      await advance(1)
      expect(children).toHaveLength(index + 2)
    }
    expect(codes().filter((code) => code === 'app/exited')).toHaveLength(4)
  })

  test('resets the backoff after a stable run', async () => {
    const { children, advance, pendingDelays } = setup()
    await flush()
    await children[0]?.exit(crash)
    await advance(1_000)
    await children[1]?.exit(crash)
    expect(pendingDelays()).toEqual([5_000])
    await advance(5_000)
    await advance(60_000)
    await children[2]?.exit(crash)
    expect(pendingDelays()).toEqual([1_000])
  })

  test('forwards SIGTERM and exits 0 without relaunching', async () => {
    const { supervisor, children, running } = setup()
    await flush()
    supervisor.stop('SIGTERM')
    expect(await running).toBe(0)
    expect(children).toHaveLength(1)
    expect(children[0]?.signals).toEqual(['SIGTERM'])
  })

  test('kills the app when it ignores the stop signal past the grace period', async () => {
    const { supervisor, children, advance, exitCode } = setup({}, { exitOnSignal: false })
    await flush()
    supervisor.stop('SIGINT')
    await advance(24_999)
    expect(exitCode()).toBeUndefined()
    await advance(1)
    expect(children[0]?.signals).toEqual(['SIGINT', 'SIGKILL'])
    expect(exitCode()).toBe(0)
  })

  test('a second stop kills the app immediately', async () => {
    const { supervisor, children, running } = setup({}, { exitOnSignal: false })
    await flush()
    supervisor.stop('SIGTERM')
    supervisor.stop('SIGTERM')
    expect(await running).toBe(0)
    expect(children[0]?.signals).toEqual(['SIGTERM', 'SIGKILL'])
  })

  test('a stop during the backoff exits without relaunching', async () => {
    const { supervisor, children, running } = setup()
    await flush()
    await children[0]?.exit(crash)
    supervisor.stop('SIGTERM')
    expect(await running).toBe(0)
    expect(children).toHaveLength(1)
  })

  test('exit 75, new version healthy: launched at once, then confirmed', async () => {
    const { children, switches, switchCalls, answerHealth, pendingDelays } = setup(
      {},
      {},
      { switchTo: '1.3.0' },
    )
    await flush()
    await children[0]?.exit({ kind: 'code', code: SWITCH_EXIT_CODE })
    expect(switches).toEqual(['1.2.0'])
    expect(children).toHaveLength(2)
    expect(pendingDelays()).toEqual([])
    answerHealth(true)
    await flush()
    expect(switchCalls).toEqual(['confirm 1.3.0'])
    // Running normally afterwards: a crash goes through the usual backoff.
    await children[1]?.exit(crash)
    expect(pendingDelays()).toEqual([1_000])
  })

  test('exit 75, new version not healthy in 60 s: stopped, rolled back, old one relaunched', async () => {
    const { children, switchCalls, answerHealth, codes } = setup({}, {}, { switchTo: '1.3.0' })
    await flush()
    await children[0]?.exit({ kind: 'code', code: SWITCH_EXIT_CODE })
    answerHealth(false)
    await flush()
    expect(children[1]?.signals).toEqual(['SIGTERM'])
    expect(codes()).toContain('update/health_timeout')
    expect(switchCalls).toEqual(['rollback 1.3.0 health_timeout'])
    expect(children).toHaveLength(3)
  })

  test('exit 75, new version exits before being healthy: rolled back at once', async () => {
    const { children, switchCalls } = setup({}, {}, { switchTo: '1.3.0' })
    await flush()
    await children[0]?.exit({ kind: 'code', code: SWITCH_EXIT_CODE })
    await children[1]?.exit({ kind: 'code', code: 1 })
    expect(switchCalls).toEqual(['rollback 1.3.0 exited'])
    expect(children).toHaveLength(3)
  })

  test('a stop during the health wait rolls the switch back and exits', async () => {
    const { supervisor, children, switchCalls, running } = setup({}, {}, { switchTo: '1.3.0' })
    await flush()
    await children[0]?.exit({ kind: 'code', code: SWITCH_EXIT_CODE })
    supervisor.stop('SIGTERM')
    expect(await running).toBe(0)
    expect(switchCalls).toEqual(['rollback 1.3.0 stopped'])
    expect(children).toHaveLength(2)
  })

  test('a stop while the switch begins rolls it back before the new version runs', async () => {
    let finishBegin: () => void = () => undefined
    const { supervisor, children, switchCalls, running } = setup({
      switchHandler: {
        begin: async (from) => {
          // The database copy, during which the container is stopped.
          await new Promise<void>((resolve) => (finishBegin = resolve))
          return { from: from.version, to: '1.3.0' }
        },
        confirm: async ({ to }) => void switchCalls.push(`confirm ${to}`),
        rollback: async ({ to }, reason) => void switchCalls.push(`rollback ${to} ${reason}`),
      },
    })
    await flush()
    await children[0]?.exit({ kind: 'code', code: SWITCH_EXIT_CODE })
    supervisor.stop('SIGTERM')
    finishBegin()
    expect(await running).toBe(0)
    expect(switchCalls).toEqual(['rollback 1.3.0 stopped'])
    expect(children).toHaveLength(1)
  })

  test('exit code 75 without a version to switch to relaunches the same one', async () => {
    const { children, advance, switches, codes } = setup()
    await flush()
    await children[0]?.exit({ kind: 'code', code: SWITCH_EXIT_CODE })
    expect(switches).toEqual(['1.2.0'])
    expect(codes()).not.toContain('app/exited')
    await advance(1_000)
    expect(children).toHaveLength(2)
  })

  test('exits 1 when no app can be prepared', async () => {
    const { running, children, codes } = setup({
      prepareApp: async () => err(supervisorError('seed/missing', 'no seed')),
    })
    expect(await running).toBe(1)
    expect(children).toHaveLength(0)
    expect(codes()).toContain('seed/missing')
  })

  test('retries with backoff when the process cannot be spawned', async () => {
    let attempts = 0
    const { advance, pendingDelays, codes } = setup({
      launch: () => {
        attempts++
        return err(supervisorError('process/spawn_failed', 'boom'))
      },
    })
    await flush()
    expect(attempts).toBe(1)
    expect(codes()).toContain('process/spawn_failed')
    expect(pendingDelays()).toEqual([1_000])
    await advance(1_000)
    expect(attempts).toBe(2)
  })
})
