import { supervisorError, type SupervisorError } from './errors'
import { err, ok, type Result } from './result'

export type Signal = 'SIGTERM' | 'SIGINT' | 'SIGKILL'

export type ExitStatus = { kind: 'code'; code: number } | { kind: 'signal'; signal: string }

export type ChildProcess = {
  pid: number
  exited: Promise<ExitStatus>
  kill: (signal: Signal) => void
}

export type LaunchSpec = {
  command: string
  args: readonly string[]
  cwd: string
  env: Readonly<Record<string, string>>
}

export type Launcher = (
  spec: LaunchSpec,
) => Result<ChildProcess, SupervisorError<'process/spawn_failed'>>

/** Spawns with inherited stdio: the app's stdout/stderr go straight to the container output. */
export const bunLauncher: Launcher = ({ command, args, cwd, env }) => {
  try {
    const proc = Bun.spawn([command, ...args], {
      cwd,
      env: { ...env },
      stdin: 'ignore',
      stdout: 'inherit',
      stderr: 'inherit',
    })
    let done = false
    const exited = proc.exited.then((code): ExitStatus => {
      done = true
      const signal = proc.signalCode ?? undefined
      return signal === undefined
        ? { kind: 'code', code }
        : { kind: 'signal', signal: String(signal) }
    })
    return ok({
      pid: proc.pid,
      exited,
      kill: (signal) => {
        if (!done) proc.kill(signal)
      },
    })
  } catch (cause) {
    return err(
      supervisorError(
        'process/spawn_failed',
        'Cannot spawn the app process',
        { command, args, cwd },
        cause,
      ),
    )
  }
}
