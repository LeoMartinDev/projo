import { mountApp } from '@projo/web-app/mount'

import { browserHost } from './browser-host.ts'
import { registerServiceWorker, reloadToLatest } from './service-worker/register.ts'

window.addEventListener('vite:preloadError', (event) => {
  const key = `projo:preload-reload:${event.payload.message}`
  if (sessionStorage.getItem(key)) return
  sessionStorage.setItem(key, '1')
  void reloadToLatest()
})

registerServiceWorker()

const container = document.getElementById('root')
if (!container) throw new Error('#root element missing from index.html')

const host = browserHost(__PROJO_VERSION__)

// TRANSITIONAL (§28): an old desktop app's window (Tauri) on the server's page gets its window
// buttons and update banner back from a separate chunk. Removed once desktop apps older than the
// bundled-UI release are gone.
if ('__TAURI_INTERNALS__' in window)
  void import('./desktop-compat/desktop-compat.ts')
    .then((compat) => compat.withDesktopCompat(host))
    .catch(() => host)
    .then((compatible) => mountApp(container, compatible))
else mountApp(container, host)
