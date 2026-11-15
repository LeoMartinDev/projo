// TRANSITIONAL (§28): desktop apps older than the bundled-UI release still load the server's web
// app in their window. For them only, this chunk (never in the entry chunk) brings back the
// window buttons, the desktop update banner and the desktop version in About; playback stays on
// html-video against the page's origin. Removed once desktop apps older than the bundled-UI
// release are gone, together with the `projo-desktop` row of the server's user-agent.ts.
import { desktopAboutRows } from '@projo/web-app/desktop/about.ts'
import { tauriInternals } from '@projo/web-app/desktop/tauri.ts'
import { desktopUpdates } from '@projo/web-app/desktop/updates.ts'
import { windowControlsChrome } from '@projo/web-app/desktop/WindowControls.tsx'
import type { AppHost } from '@projo/web-app/host'

import { eitherUpdate } from './either-update.ts'

/** The browser host, with what an old desktop app's window showed on top of it. */
export const withDesktopCompat = (host: AppHost): AppHost => {
  const internals = tauriInternals()
  if (internals === undefined) return host
  return {
    ...host,
    chrome: windowControlsChrome(),
    updates: eitherUpdate(host.updates, desktopUpdates(internals)),
    aboutRows: desktopAboutRows(internals),
  }
}
