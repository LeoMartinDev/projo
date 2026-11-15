import { setupStatusResponseSchema } from '@projo/shared/api/setup'
import { err, fromPromise, ok, type Result } from '@projo/shared/result'

import type { CommandFailure, DesktopCommands } from './desktop-commands.ts'
import { isServerCompatible } from './server-version.ts'

/** Where a server the app could reach stands (§28.3). */
export type ServerState =
  /** Ready for the app: set up, recent enough. */
  | { readonly kind: 'ready'; readonly serverUrl: string }
  /** Older than the bundled UI needs: an administrator updates it. */
  | { readonly kind: 'outdated'; readonly serverUrl: string; readonly version: string }
  /** Not set up yet: setup runs in the browser, never in the app. */
  | { readonly kind: 'not_set_up'; readonly serverUrl: string }

/** `server/invalid_url`, `server/unreachable`, `server/not_projo`, `desktop/config_not_saved`… */
export type ConnectError = CommandFailure

/** Whether the server's setup is complete (`GET /api/v1/setup/status`, over CORS). */
export type SetupCompleted = (serverUrl: string) => Promise<Result<boolean, ConnectError>>

type Deps = {
  commands: Pick<DesktopCommands, 'checkServer' | 'saveServer'>
  setupCompleted: SetupCompleted
  minimumServerVersion: string
}

/**
 * Connects to the server at `url` (typed, or saved): checks it answers like projo (from Rust),
 * refuses a server too old for the bundled UI and one not set up yet, and saves it only when it
 * is ready: a refused server never replaces the saved one (nor wipes its token).
 */
export const connectServerFactory =
  ({ commands, setupCompleted, minimumServerVersion }: Deps) =>
  async (url: string): Promise<Result<ServerState, ConnectError>> => {
    const checked = await commands.checkServer(url)
    if (!checked.ok) return checked
    const { serverUrl, version } = checked.value
    if (!isServerCompatible(version, minimumServerVersion))
      return ok({ kind: 'outdated', serverUrl, version })
    const completed = await setupCompleted(serverUrl)
    if (!completed.ok) return completed
    if (!completed.value) return ok({ kind: 'not_set_up', serverUrl })
    const saved = await commands.saveServer(serverUrl)
    if (!saved.ok) return saved
    return ok({ kind: 'ready', serverUrl: saved.value })
  }

export type ConnectServer = ReturnType<typeof connectServerFactory>

const unreachable = (message: string): ConnectError => ({ code: 'server/unreachable', message })

/** `setupCompleted` over the page's `fetch` (the server answers the desktop origin with CORS). */
export const fetchSetupCompleted =
  (fetcher: (url: string) => Promise<Response>): SetupCompleted =>
  async (serverUrl) => {
    const answered = await fromPromise(
      async () => {
        const response = await fetcher(`${serverUrl}/api/v1/setup/status`)
        return { ok: response.ok, status: response.status, body: await response.json() }
      },
      (cause) => unreachable(cause instanceof Error ? cause.message : 'setup status failed'),
    )
    if (!answered.ok) return answered
    const status = setupStatusResponseSchema.safeParse(answered.value.body)
    if (!answered.value.ok || !status.success)
      return err(unreachable(`setup status answered HTTP ${answered.value.status}`))
    return ok(status.data.completed)
  }
