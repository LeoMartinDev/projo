import { clickDownload } from '@projo/web-app/download'
import type { AppHost } from '@projo/web-app/host'

import { browserUpdates } from './app-update/browser-updates.ts'
import { appUpdater, reloadFresh, reloadToLatest } from './service-worker/register.ts'
import { browserSystemMedia } from './system-media.ts'

/**
 * The browser host: the page is served by the server, so every URL stays root-relative and the
 * session is the server's httpOnly cookie (§20). Events over `EventSource`, the last heartbeat
 * over `sendBeacon`, downloads through a link, the `<video>` engine (loaded with the player, out
 * of the entry chunk), the Media Session for the system's controls, updates through the service
 * worker (§16.4, §19).
 */
export const browserHost = (version: string): AppHost => ({
  version,
  uiFromServer: true,
  serverOrigin: '',
  apiFetch: (path, init) => fetch(path, { ...init, credentials: 'same-origin' }),
  openEvents: () => new EventSource('/api/v1/events', { withCredentials: true }),
  download: (path, filename) => clickDownload(path, filename),
  sendLeave: (path, body) => {
    navigator.sendBeacon(path, body)
  },
  session: { kind: 'cookie' },
  playerEngine: () =>
    import('@projo/web-app/engines/html-video').then((module) => module.htmlVideoEngine('')),
  systemMedia: browserSystemMedia(),
  updates: browserUpdates({ version, updater: appUpdater }),
  reloadToLatest,
  reloadFresh,
})
