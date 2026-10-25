import type { Clock } from './clock'
import type { SupervisorError } from './errors'
import type { HealthError } from './health'
import { errorFields, type Logger } from './logger'
import type { ChildProcess, ExitStatus, Launcher, Signal } from './process'
import type { Result } from './result'
import { initialRestartState, nextRestart, type RestartPolicy } from './restart-policy'
import {
  SWITCH_HEALTH_INTERVAL_MS,
  SWITCH_HEALTH_TIMEOUT_MS,
  type PendingSwitch,
  type RollbackReason,
  type SwitchHandler,
} from './switch'
import type { InstalledVersion } from './version-state'

/** Exit code by which the app asks for a version switch (PRODUCT.md §16.3). */
export const SWITCH_EXIT_CODE = 75

export type WaitForHealth = (input: {
  timeoutMs: number
  intervalMs: number
  signal?: AbortSignal
}) => Promise<Result<void, HealthError>>

export type SupervisorDeps = {
  prepareApp: () => Promise<Result<InstalledVersion, SupervisorError>>
  launch: Launcher
  bunPath: string
  appEnv: Readonly<Record<string, string>>
  /** Exit 75 (§16.3): `pending`, backup, `current`, then confirm or roll back. */
  switchHandler: SwitchHandler
  /** Polls the app's `/health` (60 s window after a switch). */
  waitForHealth: WaitForHealth
  restartPolicy: RestartPolicy
  shutdownGraceMs: number
  clock: Clock
  logger: Logger
}

export type Supervisor = {
  /** Resolves with the supervisor's exit code. */
  run: () => Promise<number>
  /** First call: graceful stop. Second call: kill the app immediately. */
  stop: (signal: Exclude<Signal, 'SIGKILL'>) => void
}

const describeExit = (status: ExitStatus): Record<string, unknown> =>
  status.kind === 'code' ? { exitCode: status.code } : { signal: status.signal }

export const supervisorFactory = (deps: SupervisorDeps): Supervisor => {
  const {
    prepareApp,
    launch,
    bunPath,
    appEnv,
    switchHandler,
    waitForHealth,
    restartPolicy,
    shutdownGraceMs,
    clock,
    logger,
  } = deps
  const stopController = new AbortController()
  let child: ChildProcess | undefined

  const forceKill = () => {
    if (child === undefined) return
    logger.warn('app did not stop in time, killing it', {
      pid: child.pid,
      graceMs: shutdownGraceMs,
    })
    child.kill('SIGKILL')
  }

  /** SIGTERM (or the given signal), then SIGKILL past the grace period. */
  const terminate = (target: ChildProcess, signal: Exclude<Signal, 'SIGKILL'>) => {
    target.kill(signal)
    const graceController = new AbortController()
    void target.exited.then(() => graceController.abort())
    void clock.sleep(shutdownGraceMs, graceController.signal).then((outcome) => {
      if (outcome === 'elapsed' && child === target) forceKill()
    })
  }

  const stop: Supervisor['stop'] = (signal) => {
    if (stopController.signal.aborted) {
      forceKill()
      return
    }
    logger.info('stop requested', { signal })
    stopController.abort()
    if (child !== undefined) terminate(child, signal)
  }

  /** After a switch: healthy within the window, or not (timeout, or the process ended first). */
  const watchSwitch = async (
    running: ChildProcess,
  ): Promise<'healthy' | 'health_timeout' | 'exited'> => {
    const watch = new AbortController()
    const outcome = await Promise.race([
      running.exited.then(() => 'exited' as const),
      waitForHealth({
        timeoutMs: SWITCH_HEALTH_TIMEOUT_MS,
        intervalMs: SWITCH_HEALTH_INTERVAL_MS,
        signal: watch.signal,
      }).then((health) => (health.ok ? ('healthy' as const) : ('health_timeout' as const))),
    ])
    watch.abort()
    return outcome
  }

  /**
   * Runs the app until it exits. With a switch in flight, the new version must answer `/health`
   * first: otherwise it is stopped and the switch rolled back (`rolledBack`).
   */
  const runOnce = async (
    app: InstalledVersion,
    switching: PendingSwitch | undefined,
  ): Promise<{ status?: ExitStatus; rolledBack?: RollbackReason }> => {
    const spawned = launch({ command: bunPath, args: [app.entry], cwd: app.dir, env: appEnv })
    if (!spawned.ok) {
      logger.error('cannot start app', errorFields(spawned.error))
      if (switching === undefined) return {}
      const reason = stopController.signal.aborted ? 'stopped' : 'exited'
      await switchHandler.rollback(switching, reason)
      return { rolledBack: reason }
    }
    const running = spawned.value
    child = running
    logger.info('app started', { version: app.version, pid: running.pid })

    if (switching !== undefined) {
      const outcome = await watchSwitch(running)
      if (outcome === 'healthy') {
        await switchHandler.confirm(switching)
      } else {
        if (outcome === 'health_timeout') {
          logger.error('new app version is not healthy in time: stopping it', {
            code: 'update/health_timeout',
            version: app.version,
            timeoutMs: SWITCH_HEALTH_TIMEOUT_MS,
          })
          terminate(running, 'SIGTERM')
        }
        const status = await running.exited
        child = undefined
        const reason = stopController.signal.aborted ? 'stopped' : outcome
        await switchHandler.rollback(switching, reason)
        return { status, rolledBack: reason }
      }
    }

    const status = await running.exited
    child = undefined
    return { status }
  }

  const run: Supervisor['run'] = async () => {
    let restartState = initialRestartState
    let switching: PendingSwitch | undefined
    while (!stopController.signal.aborted) {
      const prepared = await prepareApp()
      if (!prepared.ok) {
        logger.error('cannot prepare app', errorFields(prepared.error))
        if (switching !== undefined) {
          // `current` points to a version that cannot even be prepared: back to the old one.
          await switchHandler.rollback(switching, 'exited')
          switching = undefined
          continue
        }
        return 1
      }
      if (stopController.signal.aborted) break
      const app = prepared.value

      const startedAt = clock.now()
      const { status, rolledBack } = await runOnce(app, switching)
      switching = undefined
      const uptimeMs = clock.now() - startedAt
      if (stopController.signal.aborted) {
        logger.info('app stopped', {
          version: app.version,
          ...(status === undefined ? {} : describeExit(status)),
        })
        break
      }
      // The old version, which was running fine, is relaunched at once.
      if (rolledBack !== undefined) {
        restartState = initialRestartState
        continue
      }

      if (status?.kind === 'code' && status.code === SWITCH_EXIT_CODE) {
        switching = await switchHandler.begin(app)
        // The new version is launched at once; its health decides (no backoff).
        if (switching !== undefined) {
          restartState = initialRestartState
          continue
        }
      } else {
        logger.error('app exited unexpectedly', {
          code: 'app/exited',
          version: app.version,
          uptimeMs,
          ...(status === undefined ? {} : describeExit(status)),
        })
      }

      const next = nextRestart(restartPolicy)(restartState, { uptimeMs })
      restartState = next.state
      logger.info('app restart scheduled', {
        delayMs: next.delayMs,
        consecutiveFailures: next.state.consecutiveFailures,
      })
      if ((await clock.sleep(next.delayMs, stopController.signal)) === 'aborted') break
    }
    return 0
  }

  return { run, stop }
}
