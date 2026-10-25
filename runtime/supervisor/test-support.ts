// Test doubles shared by the supervisor tests: manual clock, fake processes, memory logger, bundle fixtures.
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { Clock, SleepOutcome } from './clock'
import type { LogFields, Logger, LogLevel } from './logger'
import { ENTRY_FILE, hashTree, MANIFEST_FILE, type Manifest } from './manifest'
import type { ChildProcess, ExitStatus, Launcher, LaunchSpec, Signal } from './process'
import { ok } from './result'

export const flush = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await new Promise((resolve) => setImmediate(resolve))
}

type Timer = { at: number; resolve: (outcome: SleepOutcome) => void }

export const manualClock = () => {
  let now = 0
  let timers: Timer[] = []
  const clock: Clock = {
    now: () => now,
    sleep: (ms, signal) =>
      new Promise((resolve) => {
        if (signal?.aborted) return resolve('aborted')
        const timer: Timer = { at: now + ms, resolve }
        timers.push(timer)
        signal?.addEventListener(
          'abort',
          () => {
            timers = timers.filter((t) => t !== timer)
            resolve('aborted')
          },
          { once: true },
        )
      }),
  }
  const advance = async (ms: number) => {
    await flush()
    now += ms
    const due = timers.filter((t) => t.at <= now).sort((a, b) => a.at - b.at)
    timers = timers.filter((t) => t.at > now)
    for (const timer of due) timer.resolve('elapsed')
    await flush()
  }
  return { clock, advance, pendingDelays: () => timers.map((t) => t.at - now) }
}

export type FakeChild = {
  spec: LaunchSpec
  signals: Signal[]
  exit: (status: ExitStatus) => Promise<void>
}

export const fakeLauncher = ({ exitOnSignal = true }: { exitOnSignal?: boolean } = {}) => {
  const children: FakeChild[] = []
  let nextPid = 100
  const launch: Launcher = (spec) => {
    let resolveExit: (status: ExitStatus) => void = () => undefined
    let exited = false
    const exitedPromise = new Promise<ExitStatus>((resolve) => {
      resolveExit = resolve
    })
    const exit = async (status: ExitStatus) => {
      if (exited) return
      exited = true
      resolveExit(status)
      await flush()
    }
    const signals: Signal[] = []
    const handle: ChildProcess = {
      pid: nextPid++,
      exited: exitedPromise,
      kill: (signal) => {
        signals.push(signal)
        if (signal === 'SIGKILL' || exitOnSignal) void exit({ kind: 'signal', signal })
      },
    }
    children.push({ spec, signals, exit })
    return ok(handle)
  }
  return { launch, children }
}

export type LogEntry = { level: LogLevel; msg: string; fields: LogFields }

export const memoryLogger = () => {
  const entries: LogEntry[] = []
  const at =
    (level: LogLevel) =>
    (msg: string, fields: LogFields = {}) => {
      entries.push({ level, msg, fields })
    }
  const logger: Logger = {
    debug: at('debug'),
    info: at('info'),
    warn: at('warn'),
    error: at('error'),
  }
  return {
    logger,
    entries,
    codes: () => entries.flatMap((e) => (typeof e.fields.code === 'string' ? [e.fields.code] : [])),
  }
}

const created: string[] = []

export const tempDir = async (prefix = 'projo-runtime-'): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  created.push(dir)
  return dir
}

export const cleanupTempDirs = async (): Promise<void> => {
  await Promise.all(created.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
}

/** Writes a minimal valid app bundle (with manifest) into `dir`. */
export const writeBundle = async (
  dir: string,
  {
    version,
    runtimeMin = '0.1.0',
    files = {},
  }: { version: string; runtimeMin?: string; files?: Record<string, string> },
): Promise<Manifest> => {
  const all = {
    [ENTRY_FILE]: `console.log('projo ${version}')\n`,
    'public/index.html': '<!doctype html>',
    ...files,
  }
  for (const [path, content] of Object.entries(all)) {
    await mkdir(dirname(join(dir, path)), { recursive: true })
    await Bun.write(join(dir, path), content)
  }
  const manifest: Manifest = {
    version,
    runtimeMin,
    builtAt: '2026-10-23T00:00:00.000Z',
    files: await hashTree(dir),
  }
  await Bun.write(join(dir, MANIFEST_FILE), JSON.stringify(manifest))
  return manifest
}
