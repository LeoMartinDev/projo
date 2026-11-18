/**
 * A fixed reason for a failed upstream request (§29.2, §20): `timeout`, `aborted`, the error's
 * code (`ECONNREFUSED`, `ENOTFOUND`, `UnsupportedRedirectProtocol`…), else `network`. Never the
 * error itself nor its message: Bun writes the requested URL, query and secrets included, into
 * some of them, and the reason reaches logs, job errors and the admin.
 */
export const fetchFailureReason = (cause: unknown): string => {
  if (!(cause instanceof Error) && !(cause instanceof DOMException)) return 'network'
  if (cause.name === 'TimeoutError') return 'timeout'
  if (cause.name === 'AbortError') return 'aborted'
  const code: unknown = 'code' in cause ? cause.code : undefined
  return typeof code === 'string' && /^[A-Za-z][A-Za-z0-9_]{0,39}$/u.test(code) ? code : 'network'
}
