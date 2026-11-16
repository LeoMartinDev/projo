// The desktop app's bundled UI (PRODUCT.md §28): the screens before the app (server address,
// unreachable, server too old, setup in the browser), then `@projo/web-app` mounted with the
// desktop host on the ready server. "Change server" (the tray's `desktop://change-server`,
// Ctrl+Shift+U) signs out on the server, then the app forgets the token and reloads this page
// with `?change=1`. One visual from launch to the first screen: the splash of index.html, painted
// before this script, shows the hidden window and stays over it until a screen is drawn.
import '@projo/design/fonts.css'
import '@projo/design/tokens.css'
import '@projo/design/base.css'
import './native.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { I18nextProvider } from 'react-i18next'

import { listenTauri, tauriInternals } from '@projo/web-app/desktop/tauri.ts'
import { WindowControls } from '@projo/web-app/desktop/WindowControls.tsx'
import { mountApp } from '@projo/web-app/mount'

import { connectServerFactory, fetchSetupStatus } from './connect-server.ts'
import { tauriCommands } from './desktop-commands.ts'
import { desktopHost } from './desktop-host.ts'
import { Entry } from './Entry.tsx'
import { type ReadyServer, startingStep } from './entry-flow.ts'
import { entryI18n } from './entry-i18n.ts'
import { leaveServerFactory } from './leave-server.ts'
import { minimumServerVersion } from './server-version.ts'
import { afterNextPaint, splashFactory } from './splash.ts'

const internals = tauriInternals()
if (internals === undefined) throw new Error('the bundled UI runs inside the projo desktop app')

const splash = splashFactory({
  element: document.getElementById('splash') ?? undefined,
  showWindow: () => internals.invoke('desktop_window_ready'),
  afterPaint: afterNextPaint,
  later: (run, ms) => void setTimeout(run, ms),
  warn: (message, cause) => console.warn(message, cause),
})
splash.showWindow()

const container = document.getElementById('root')
const entryContainer = document.getElementById('entry')
if (!container || !entryContainer) throw new Error('#root or #entry missing from index.html')

const commands = tauriCommands(internals)
const changing = new URLSearchParams(location.search).has('change')
const connect = connectServerFactory({
  commands,
  setupStatus: fetchSetupStatus((url, signal) =>
    fetch(url, { credentials: 'omit', headers: { accept: 'application/json' }, signal }),
  ),
  minimumServerVersion,
})

const leaveServer = leaveServerFactory({ commands, fetch: (url, init) => fetch(url, init) })
window.addEventListener(
  'keydown',
  (event) => {
    if (!event.ctrlKey || !event.shiftKey || event.altKey || event.code !== 'KeyU') return
    event.preventDefault()
    void leaveServer()
  },
  true,
)
void listenTauri(internals, 'desktop://change-server', () => void leaveServer()).catch(
  (cause: unknown) => console.warn('the tray cannot reach the page', cause),
)

// The app's routes start at the page's path (a reload keeps it); the bundled entry and the
// "Change server" query are not routes.
const appLocation = () => {
  const path = location.pathname === '/index.html' ? '/' : location.pathname
  return changing ? '/' : `${path}${location.search}${location.hash}`
}

// A first route still loading past this shows its pending page rather than the splash.
const firstRouteTimeoutMs = 8_000

const start = async () => {
  // Read with the server check, not after it: the saved server's token and the device name.
  const credentials = Promise.all([commands.getToken(), commands.deviceName()])
  const saved = await commands.getServer()
  if (!saved.ok) console.warn('no saved server', saved.error)
  const savedUrl = saved.ok ? saved.value : undefined
  const entryRoot = createRoot(entryContainer)

  let mounting = false
  const ready = async ({ serverUrl, setupStatus }: ReadyServer) => {
    if (mounting) return
    mounting = true
    // Another server than the saved one (typed, or upgraded to https) has its own token.
    const [early, deviceName] = await credentials
    const token = serverUrl === savedUrl ? early : await commands.getToken()
    if (!token.ok) console.warn('the session token could not be read', token.error)
    history.replaceState(history.state, '', appLocation())

    // The Entry (or the splash) stays over the app until its first route is drawn: no blank
    // frame between them.
    let handedOver = false
    const handOver = () => {
      if (handedOver) return
      handedOver = true
      entryRoot.unmount()
      entryContainer.remove()
      splash.dismiss()
    }
    setTimeout(handOver, firstRouteTimeoutMs)
    mountApp(
      container,
      desktopHost({
        version: __PROJO_VERSION__,
        serverOrigin: serverUrl,
        token: token.ok ? token.value : undefined,
        deviceName,
        commands,
        internals,
      }),
      { setupStatus, onFirstRoute: handOver },
    )
  }

  entryRoot.render(
    <StrictMode>
      <I18nextProvider i18n={entryI18n()}>
        <Entry
          start={startingStep({ saved: savedUrl, changing })}
          connect={connect}
          onReady={(server) => void ready(server)}
          onShown={splash.dismiss}
        />
        <WindowControls />
      </I18nextProvider>
    </StrictMode>,
  )
}

void start()
