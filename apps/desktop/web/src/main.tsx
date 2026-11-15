// The desktop app's bundled UI (PRODUCT.md §28): the screens before the app (server address,
// unreachable, server too old, setup in the browser), then `@projo/web-app` mounted with the
// desktop host on the ready server. "Change server" (the tray's `desktop://change-server`,
// Ctrl+Shift+U) signs out on the server, then the app forgets the token and reloads this page
// with `?change=1`.
import '@projo/design/fonts.css'
import '@projo/design/tokens.css'
import '@projo/design/base.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { I18nextProvider } from 'react-i18next'

import { listenTauri, tauriInternals } from '@projo/web-app/desktop/tauri.ts'
import { WindowControls } from '@projo/web-app/desktop/WindowControls.tsx'
import { mountApp } from '@projo/web-app/mount'

import { connectServerFactory, fetchSetupCompleted } from './connect-server.ts'
import { tauriCommands } from './desktop-commands.ts'
import { desktopHost } from './desktop-host.ts'
import { Entry } from './Entry.tsx'
import { startingStep } from './entry-flow.ts'
import { entryI18n } from './entry-i18n.ts'
import { leaveServerFactory } from './leave-server.ts'
import { minimumServerVersion } from './server-version.ts'

const container = document.getElementById('root')
if (!container) throw new Error('#root element missing from index.html')
const internals = tauriInternals()
if (internals === undefined) throw new Error('the bundled UI runs inside the projo desktop app')

const commands = tauriCommands(internals)
const changing = new URLSearchParams(location.search).has('change')
const connect = connectServerFactory({
  commands,
  setupCompleted: fetchSetupCompleted((url) =>
    fetch(url, { credentials: 'omit', headers: { accept: 'application/json' } }),
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

const start = async () => {
  const saved = await commands.getServer()
  if (!saved.ok) console.warn('no saved server', saved.error)
  const root = createRoot(container)
  const ready = async (serverOrigin: string) => {
    const [token, deviceName] = await Promise.all([commands.getToken(), commands.deviceName()])
    if (!token.ok) console.warn('the session token could not be read', token.error)
    root.unmount()
    history.replaceState(history.state, '', appLocation())
    mountApp(
      container,
      desktopHost({
        version: __PROJO_VERSION__,
        serverOrigin,
        token: token.ok ? token.value : undefined,
        deviceName,
        commands,
        internals,
      }),
    )
  }
  root.render(
    <StrictMode>
      <I18nextProvider i18n={entryI18n()}>
        <Entry
          start={startingStep({ saved: saved.ok ? saved.value : undefined, changing })}
          connect={connect}
          onReady={(serverOrigin) => void ready(serverOrigin)}
        />
        <WindowControls />
      </I18nextProvider>
    </StrictMode>,
  )
}

void start()
