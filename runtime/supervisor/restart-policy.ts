export type RestartPolicy = {
  /** Delay before the n-th consecutive restart; the last value repeats. */
  delaysMs: readonly number[]
  /** An app that ran at least this long is considered stable: the backoff starts over. */
  stableAfterMs: number
}

export type RestartState = { consecutiveFailures: number }

export const defaultRestartPolicy: RestartPolicy = {
  delaysMs: [1_000, 5_000, 30_000],
  stableAfterMs: 60_000,
}

export const initialRestartState: RestartState = { consecutiveFailures: 0 }

export const nextRestart =
  (policy: RestartPolicy) =>
  (
    state: RestartState,
    { uptimeMs }: { uptimeMs: number },
  ): { state: RestartState; delayMs: number } => {
    const consecutiveFailures = uptimeMs >= policy.stableAfterMs ? 1 : state.consecutiveFailures + 1
    const index = Math.min(consecutiveFailures, policy.delaysMs.length) - 1
    return { state: { consecutiveFailures }, delayMs: policy.delaysMs[index] ?? 0 }
  }
