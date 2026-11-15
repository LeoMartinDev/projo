import type { HostSession } from '@projo/web-app/host'

import type { DesktopCommands } from './desktop-commands.ts'

type TokenStore = Pick<DesktopCommands, 'setToken' | 'clearToken'>

/**
 * The desktop host's session (§28.3): a bearer token, held in memory for the requests and kept
 * at rest by the app in the Windows Credential Manager (never in the page's storage). A store that
 * fails leaves the session working until the app quits (logged): the next launch signs in again.
 */
export const tokenSession = ({
  token: initial,
  deviceName,
  store,
  warn = (message, cause) => console.warn(message, cause),
}: {
  token: string | undefined
  deviceName: string
  store: TokenStore
  warn?: (message: string, cause: unknown) => void
}): { session: HostSession; bearer: () => string | undefined } => {
  let token = initial
  return {
    bearer: () => token,
    session: {
      kind: 'token',
      deviceName,
      keep: async (next) => {
        token = next
        const kept = await store.setToken(next)
        if (!kept.ok)
          warn('the session token could not be kept in the Credential Manager', kept.error)
      },
      drop: async () => {
        token = undefined
        const cleared = await store.clearToken()
        if (!cleared.ok)
          warn('the session token could not be removed from the Credential Manager', cleared.error)
      },
    },
  }
}
