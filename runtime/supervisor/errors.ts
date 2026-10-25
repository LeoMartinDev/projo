export type SupervisorErrorCode =
  | 'config/invalid'
  | 'data/not_writable'
  | 'app/link_invalid'
  | 'app/link_failed'
  | 'app/manifest_invalid'
  | 'app/entry_missing'
  | 'app/version_mismatch'
  | 'app/file_corrupted'
  | 'seed/missing'
  | 'seed/install_failed'
  | 'process/spawn_failed'
  | 'health/unreachable'
  | 'health/unhealthy'

export type SupervisorError<Code extends SupervisorErrorCode = SupervisorErrorCode> = {
  code: Code
  message: string
  context?: Record<string, unknown>
  cause?: unknown
}

export const supervisorError = <Code extends SupervisorErrorCode>(
  code: Code,
  message: string,
  context?: Record<string, unknown>,
  cause?: unknown,
): SupervisorError<Code> => ({
  code,
  message,
  ...(context === undefined ? {} : { context }),
  ...(cause === undefined ? {} : { cause }),
})
