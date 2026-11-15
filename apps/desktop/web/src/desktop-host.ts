import { desktopAboutRows } from '@projo/web-app/desktop/about.ts'
import { listenTauri, type TauriInternals } from '@projo/web-app/desktop/tauri.ts'
import { desktopUpdates } from '@projo/web-app/desktop/updates.ts'
import { windowControlsChrome } from '@projo/web-app/desktop/WindowControls.tsx'
import { saveBlob } from '@projo/web-app/download'
import { createFetchEvents } from '@projo/web-app/fetch-event-source'
import type { AppHost } from '@projo/web-app/host'

import type { DesktopCommands } from './desktop-commands.ts'
import { serverRequests } from './server-requests.ts'
import { desktopSystemMedia } from './system-media.ts'
import { tokenSession } from './token-session.ts'

/**
 * The desktop host (§28): the bundled page on http://tauri.localhost, an API client of the server
 * at `serverOrigin` with a bearer token (kept by the app in the Credential Manager). Events over a
 * `fetch` stream, downloads as blobs, the last heartbeat as a `keepalive` fetch, libmpv for
 * playback (html-video outside the app), Windows' media controls over IPC, the window buttons, the
 * app's own update and version.
 */
export const desktopHost = ({
  version,
  serverOrigin,
  token,
  deviceName,
  commands,
  internals,
}: {
  version: string
  serverOrigin: string
  token: string | undefined
  deviceName: string
  commands: Pick<DesktopCommands, 'setToken' | 'clearToken'>
  internals: TauriInternals
}): AppHost => {
  const { session, bearer } = tokenSession({ token, deviceName, store: commands })
  const requests = serverRequests({
    serverOrigin,
    bearer,
    fetch: (url, init) => fetch(url, init),
  })
  const reload = async () => {
    location.reload()
  }
  return {
    version,
    uiFromServer: false,
    serverOrigin,
    apiFetch: requests.apiFetch,
    openEvents: createFetchEvents({ connect: requests.connectEvents }),
    download: (path, filename) => {
      void requests.fetchDownload(path, filename).then((download) => {
        if (download.ok) saveBlob(download.value.blob, download.value.filename)
        else console.warn('download failed', download.error)
      })
    },
    sendLeave: requests.sendLeave,
    session,
    playerEngine: async () => {
      const { mpvEngine } = await import('@projo/web-app/engines/mpv')
      const engine = mpvEngine(serverOrigin)
      if (engine !== undefined) return engine
      const { htmlVideoEngine } = await import('@projo/web-app/engines/html-video')
      return htmlVideoEngine(serverOrigin)
    },
    systemMedia: desktopSystemMedia({
      invoke: (command, args) => internals.invoke(command, args),
      listen: (event, handle) => listenTauri(internals, event, handle),
    }),
    chrome: windowControlsChrome(),
    updates: desktopUpdates(internals),
    aboutRows: desktopAboutRows(internals),
    // The UI ships with the app: a server update changes nothing here, a reload starts it again.
    reloadToLatest: reload,
    reloadFresh: reload,
  }
}
