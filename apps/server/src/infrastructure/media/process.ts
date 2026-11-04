import { constants, setPriority } from 'node:os'

import { appError, type AppError, err, ok, type Result } from '@projo/shared'

const isAborted = (signal: AbortSignal | undefined): boolean => signal?.aborted === true

export type ProcessOutput = { exitCode: number; stdout: string; stderr: string }

export type ProcessError = AppError<
  'media/binary_missing' | 'media/timeout' | 'media/ffmpeg_failed'
>

export type ProcessPriority = 'normal' | 'background'

export const lowerProcessPriority = (pid: number): boolean => {
  try {
    setPriority(pid, constants.priority.PRIORITY_LOW)
    return true
  } catch {
    return false
  }
}

export const runProcess = async ({
  command,
  args,
  timeoutMs,
  signal,
  priority = 'normal',
}: {
  command: string
  args: readonly string[]
  timeoutMs: number
  signal?: AbortSignal
  priority?: ProcessPriority
}): Promise<Result<ProcessOutput, ProcessError>> => {
  if (signal?.aborted === true) {
    return err(appError('media/ffmpeg_failed', 'aborted before start', { context: { command } }))
  }
  let child: ReturnType<typeof Bun.spawn<'ignore', 'pipe', 'pipe'>>
  try {
    child = Bun.spawn([command, ...args], { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' })
  } catch (cause) {
    return err(
      appError('media/binary_missing', `cannot run ${command}`, { context: { command }, cause }),
    )
  }
  if (priority === 'background') lowerProcessPriority(child.pid)
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    child.kill('SIGKILL')
  }, timeoutMs)
  const onAbort = () => child.kill('SIGKILL')
  signal?.addEventListener('abort', onAbort, { once: true })
  try {
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ])
    if (timedOut) {
      return err(
        appError('media/timeout', `${command} timed out`, { context: { command, timeoutMs } }),
      )
    }
    if (isAborted(signal)) {
      return err(appError('media/ffmpeg_failed', `${command} aborted`, { context: { command } }))
    }
    return ok({ exitCode, stdout, stderr })
  } catch (cause) {
    return err(
      appError('media/ffmpeg_failed', `${command} failed`, { context: { command }, cause }),
    )
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  }
}

export const stderrTail = (stderr: string, maxChars = 600): string =>
  stderr.length <= maxChars ? stderr.trim() : `…${stderr.slice(-maxChars).trim()}`
