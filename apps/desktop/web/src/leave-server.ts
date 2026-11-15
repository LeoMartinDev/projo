import type { DesktopCommands } from './desktop-commands.ts'

/** How long sign-out may take before the app changes server anyway (an unreachable server). */
export const signOutTimeoutMs = 3_000

type Deps = {
  commands: Pick<DesktopCommands, 'getServer' | 'getToken' | 'changeServer'>
  /** `fetch` with a deadline (`AbortSignal.timeout`). */
  fetch: (url: string, init: RequestInit) => Promise<Response>
  timeoutMs?: number
}

/**
 * "Change server" (§28.3: the tray's `desktop://change-server`, Ctrl+Shift+U): signs the session
 * out on the server when a token is kept (best effort, bounded: an unreachable server only lets
 * it expire), then has the app forget the token and show the server address screen. One at a time.
 */
export const leaveServerFactory = ({ commands, fetch, timeoutMs = signOutTimeoutMs }: Deps) => {
  let leaving = false
  return async (): Promise<void> => {
    if (leaving) return
    leaving = true
    const [server, token] = await Promise.all([commands.getServer(), commands.getToken()])
    const serverUrl = server.ok ? server.value : undefined
    const bearer = token.ok ? token.value : undefined
    if (serverUrl !== undefined && bearer !== undefined)
      await fetch(`${serverUrl}/api/v1/auth/logout`, {
        method: 'POST',
        headers: { authorization: `Bearer ${bearer}` },
        credentials: 'omit',
        signal: AbortSignal.timeout(timeoutMs),
      }).catch(() => undefined)
    const changed = await commands.changeServer()
    if (!changed.ok) {
      console.warn('change server failed', changed.error)
      leaving = false
    }
  }
}
