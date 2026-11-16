import { type ReactNode, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'

import './window-controls.css'

import { type TauriInternals, tauriInternals } from './tauri.ts'

// Whether any window buttons show (the screens before the app and the app overlap while one hands
// over to the other): pages keep clear of them through `--chrome-inset` while one does.
const shown = new Set<symbol>()
const markShown = (id: symbol, visible: boolean) => {
  if (visible) shown.add(id)
  else shown.delete(id)
  document.documentElement.toggleAttribute('data-window-controls', shown.size > 0)
}

// The drag strip is the document's first element: WebView2 adds the `app-region: drag` areas and
// takes the `no-drag` ones away in document order, so every control after it stays clickable.
const dragLayer = (): HTMLElement => {
  const existing = document.getElementById('window-drag-layer') ?? undefined
  if (existing !== undefined) return existing
  const layer = document.createElement('div')
  layer.id = 'window-drag-layer'
  document.body.prepend(layer)
  return layer
}

const Controls = ({ invoke }: { invoke: TauriInternals['invoke'] }) => {
  const { t } = useTranslation()
  const [maximized, setMaximized] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const [layer] = useState(dragLayer)

  useEffect(() => {
    const read = () => {
      void Promise.all([
        invoke('plugin:window|is_maximized'),
        invoke('plugin:window|is_fullscreen'),
      ])
        .then(([isMaximized, isFullscreen]) => {
          setMaximized(isMaximized === true)
          setFullscreen(isFullscreen === true)
        })
        .catch(() => undefined)
    }
    read()
    window.addEventListener('resize', read)
    return () => window.removeEventListener('resize', read)
  }, [invoke])

  useEffect(() => {
    const id = Symbol('window-controls')
    markShown(id, !fullscreen)
    return () => markShown(id, false)
  }, [fullscreen])

  if (fullscreen) return undefined
  const run = (command: string) => () =>
    void invoke(`plugin:window|${command}`).catch(() => undefined)
  return (
    <>
      {/* The window has no native frame (§28.4): its top strip and the regions marked
          `data-window-drag` are its title bar (window-controls.css): WebView2 moves the window,
          snaps it, maximizes it on a double click and opens the system menu on a right click. */}
      {createPortal(<div className="window-drag-strip" aria-hidden="true" />, layer)}
      <div className="window-controls">
        <button
          type="button"
          className="window-controls__button"
          aria-label={t('window.minimize')}
          onClick={run('minimize')}
        >
          <svg viewBox="0 0 10 10" aria-hidden="true">
            <path d="M0 5.5h10" />
          </svg>
        </button>
        <button
          type="button"
          className="window-controls__button"
          aria-label={t(maximized ? 'window.restore' : 'window.maximize')}
          onClick={run('toggle_maximize')}
        >
          <svg viewBox="0 0 10 10" aria-hidden="true">
            {maximized ? (
              <path d="M.5 2.5h7v7h-7zM2.5 2.5v-2h7v7h-2" />
            ) : (
              <path d="M.5.5h9v9h-9z" />
            )}
          </svg>
        </button>
        <button
          type="button"
          className="window-controls__button window-controls__button--close"
          aria-label={t('common.close')}
          onClick={run('close')}
        >
          <svg viewBox="0 0 10 10" aria-hidden="true">
            <path d="M0 0l10 10M10 0L0 10" />
          </svg>
        </button>
      </div>
    </>
  )
}

/** The desktop app's window buttons and title bar (§28.4); nothing in a browser. */
export const WindowControls = () => {
  const internals = tauriInternals()
  return internals === undefined ? undefined : <Controls invoke={internals.invoke} />
}

/** `AppHost.chrome` of a desktop host: the window buttons. */
export const windowControlsChrome = (): ReactNode => <WindowControls />
