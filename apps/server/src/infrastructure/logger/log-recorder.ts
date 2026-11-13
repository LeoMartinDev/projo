import type { LogRecord, LogStore } from '../../core/logs/log.ts'

/**
 * Collects the lines the logger writes and stores them in batches. The logger exists before the
 * data folder is ready, so lines are held in memory until a store is attached (at most
 * `capacity`, the oldest dropped first), then written every `flushEveryMs` in one transaction.
 */
export type LogRecorder = {
  record: (record: LogRecord) => void
  attach: (store: Pick<LogStore, 'append'>) => void
  /** Writes what is pending now. */
  flush: () => void
  /** Flushes, then stops writing (lines recorded after it are dropped). */
  detach: () => void
}

type Deps = {
  capacity?: number
  flushEveryMs?: number
  /** Where a failed write is reported: never through the logger, which would record it again. */
  reportFailure?: (message: string) => void
}

export const createLogRecorder = ({
  capacity = 10_000,
  flushEveryMs = 1_000,
  reportFailure = (message) => process.stderr.write(`${message}\n`),
}: Deps = {}): LogRecorder => {
  let pending: LogRecord[] = []
  let dropped = 0
  let store: Pick<LogStore, 'append'> | undefined
  let timer: ReturnType<typeof setInterval> | undefined
  let detached = false

  const flush = (): void => {
    if (store === undefined || pending.length === 0) return
    const batch = pending
    pending = []
    try {
      store.append(batch)
    } catch (cause) {
      reportFailure(`log store write failed, ${batch.length} lines lost: ${String(cause)}`)
    }
  }

  return {
    record: (record) => {
      if (detached) return
      pending.push(record)
      if (pending.length > capacity) {
        pending.shift()
        dropped += 1
      }
    },
    attach: (target) => {
      store = target
      if (dropped > 0) {
        reportFailure(`log recorder dropped ${dropped} lines before the store was ready`)
        dropped = 0
      }
      flush()
      timer ??= setInterval(flush, flushEveryMs)
      timer.unref?.()
    },
    flush,
    detach: () => {
      flush()
      clearInterval(timer)
      timer = undefined
      store = undefined
      detached = true
      pending = []
    },
  }
}
