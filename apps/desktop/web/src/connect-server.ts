import { type SetupStatusResponse, setupStatusResponseSchema } from '@projo/shared/api/setup'
import { err, fromPromise, ok, type Result } from '@projo/shared/result'

import type { CommandFailure, DesktopCommands } from './desktop-commands.ts'
import { isServerCompatible } from './server-version.ts'

/** Where a server the app could reach stands (§28.3). */
export type ServerState =
  /**
   * Ready for the app: set up, recent enough. `setupStatus`: what `/setup/status` answered, handed
   * to the app so that it does not ask again.
   */
  | {
      readonly kind: 'ready'
      readonly serverUrl: string
      readonly setupStatus: SetupStatusResponse
    }
  /** Older than the bundled UI needs: an administrator updates it. */
  | { readonly kind: 'outdated'; readonly serverUrl: string; readonly version: string }
  /** Not set up yet: setup runs in the browser, never in the app. */
  | { readonly kind: 'not_set_up'; readonly serverUrl: string }

/** `server/invalid_url`, `server/unreachable`, `server/not_projo`, `desktop/config_not_saved`… */
export type ConnectError = CommandFailure

/** The server's setup status (`GET /api/v1/setup/status`, over CORS). */
export type SetupStatus = (serverUrl: string) => Promise<Result<SetupStatusResponse, ConnectError>>

type Deps = {
  commands: Pick<DesktopCommands, 'checkServer' | 'saveServer'>
  setupStatus: SetupStatus
  minimumServerVersion: string
}

/**
 * Connects to the server at `url` (typed, or saved): checks it answers like projo (from Rust),
 * refuses a server too old for the bundled UI and one not set up yet, and saves it only when it
 * is ready: a refused server never replaces the saved one (nor wipes its token).
 */
export const connectServerFactory =
  ({ commands, setupStatus, minimumServerVersion }: Deps) =>
  async (url: string): Promise<Result<ServerState, ConnectError>> => {
    const checked = await commands.checkServer(url)
    if (!checked.ok) return checked
    const { serverUrl, version } = checked.value
    if (!isServerCompatible(version, minimumServerVersion))
      return ok({ kind: 'outdated', serverUrl, version })
    const status = await setupStatus(serverUrl)
    if (!status.ok) return status
    if (!status.value.completed) return ok({ kind: 'not_set_up', serverUrl })
    const saved = await commands.saveServer(serverUrl)
    if (!saved.ok) return saved
    return ok({ kind: 'ready', serverUrl: saved.value, setupStatus: status.value })
  }

export type ConnectServer = ReturnType<typeof connectServerFactory>

const unreachable = (message: string): ConnectError => ({ code: 'server/unreachable', message })

/** Like the `/health` check of `check_server` (§28.3). */
export const setupStatusTimeoutMs = 6_000

/**
 * `setupStatus` over the page's `fetch` (the server answers the desktop origin with CORS). A
 * server that accepts the connection but never answers, or never ends its body, is unreachable
 * after `timeoutMs`: `fetcher` gets the signal that aborts it, and the answer is given up then
 * even if it ignores the signal.
 */
export const fetchSetupStatus =
  (
    fetcher: (url: string, signal: AbortSignal) => Promise<Response>,
    { timeoutMs = setupStatusTimeoutMs }: { timeoutMs?: number } = {},
  ): SetupStatus =>
  async (serverUrl) => {
    const answered = await fromPromise(
      async () => {
        const signal = AbortSignal.timeout(timeoutMs)
        const givenUp = new Promise<never>((_resolve, reject) => {
          signal.addEventListener(
            'abort',
            () => reject(new Error(`setup status: no answer within ${timeoutMs} ms`)),
            { once: true },
          )
        })
        const read = async () => {
          const response = await fetcher(`${serverUrl}/api/v1/setup/status`, signal)
          return { ok: response.ok, status: response.status, body: await response.json() }
        }
        return Promise.race([read(), givenUp])
      },
      (cause) => unreachable(cause instanceof Error ? cause.message : 'setup status failed'),
    )
    if (!answered.ok) return answered
    const status = setupStatusResponseSchema.safeParse(answered.value.body)
    if (!answered.value.ok || !status.success)
      return err(unreachable(`setup status answered HTTP ${answered.value.status}`))
    return ok(status.data)
  }
