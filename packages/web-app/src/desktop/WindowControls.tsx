import { type ReactNode, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'

import './window-controls.css'

import { type TauriInternals, tauriInternals } from './tauri.ts'
import { startsWindowDrag, windowFrameOf } from './window-frame.ts'

// Whether any window buttons show (the screens before the app and the app overlap while one hands
// over to the other): pages keep clear of them through `--chrome-inset` while one does.
const shown = new Set<symbol>()
const markShown = (id: symbol, visible: boolean) => {
  if (visible) shown.add(id)
  else shown.delete(id)
  document.documentElement.toggleAttribute('data-window-controls', shown.size > 0)
}

// The drag strip is the document's first element: WebView2 adds the `app-region: drag` areas and
// takes the `no-drag` ones away in document order, so the controls after it that lie under it (in
// the title bar, the window buttons and the screens' top bars, `data-window-top`) stay clickable.
const dragLayer = (): HTMLElement => {
  const existing = document.getElementById('window-drag-layer') ?? undefined
  if (existing !== undefined) return existing
  const layer = document.createElement('div')
  layer.id = 'window-drag-layer'
  document.body.prepend(layer)
  return layer
}

// How long after the last resize event the title bar's regions come back.
const resizeSettleMs = 200

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

  // WebView2 recomputes the title bar's regions on every frame of a resize, and a drag region with
  // its controls cut out of it is slow to recompute (a resize frame took 30 ms instead of 10): the
  // page has none while the window is being resized (window-controls.css), back once it settles.
  useEffect(() => {
    const root = document.documentElement
    let settle: ReturnType<typeof setTimeout> | undefined
    const resized = () => {
      root.setAttribute('data-window-resizing', '')
      clearTimeout(settle)
      settle = setTimeout(() => root.removeAttribute('data-window-resizing'), resizeSettleMs)
    }
    window.addEventListener('resize', resized)
    return () => {
      window.removeEventListener('resize', resized)
      clearTimeout(settle)
      root.removeAttribute('data-window-resizing')
    }
  }, [])

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

const useFullscreen = (invoke: TauriInternals['invoke']) => {
  const [fullscreen, setFullscreen] = useState(false)
  useEffect(() => {
    const read = () => {
      void invoke('plugin:window|is_fullscreen')
        .then((isFullscreen) => setFullscreen(isFullscreen === true))
        .catch(() => undefined)
    }
    read()
    window.addEventListener('resize', read)
    return () => window.removeEventListener('resize', read)
  }, [invoke])
  return fullscreen
}

// macOS: the system's buttons stay at the top left, over the page (pages keep clear of them through
// `--chrome-inset-start` while they show), and WebKit has no `app-region`: pressing the title bar
// (window-frame.ts) moves the window, a double click zooms it, like a native title bar.
const SystemFrame = ({ invoke }: { invoke: TauriInternals['invoke'] }) => {
  const fullscreen = useFullscreen(invoke)

  useEffect(() => {
    if (fullscreen) return undefined
    const root = document.documentElement
    root.setAttribute('data-window-frame', 'system')
    const pressed = (event: MouseEvent) => {
      if (event.button !== 0 || !(event.target instanceof Element)) return
      if (!startsWindowDrag(event.target, event.clientY)) return
      event.preventDefault()
      const command = event.detail === 2 ? 'internal_toggle_maximize' : 'start_dragging'
      void invoke(`plugin:window|${command}`).catch(() => undefined)
    }
    document.addEventListener('mousedown', pressed)
    return () => {
      document.removeEventListener('mousedown', pressed)
      root.removeAttribute('data-window-frame')
    }
  }, [fullscreen, invoke])

  return undefined
}

/** The desktop app's window buttons and title bar (§28.4); nothing in a browser. */
export const WindowControls = () => {
  const internals = tauriInternals()
  if (internals === undefined) return undefined
  return windowFrameOf(navigator.userAgent) === 'system' ? (
    <SystemFrame invoke={internals.invoke} />
  ) : (
    <Controls invoke={internals.invoke} />
  )
}

/** `AppHost.chrome` of a desktop host: the window buttons. */
export const windowControlsChrome = (): ReactNode => <WindowControls />
