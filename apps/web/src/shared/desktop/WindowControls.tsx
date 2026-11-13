import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import './window-controls.css'

import { type TauriInternals, tauriInternals } from './tauri.ts'

// Kept equal to the height of `.window-controls`.
const dragStripHeight = 32

// What takes the pointer for itself: pressing it never moves the window.
const interactive =
  'a, button, input, select, textarea, label, summary, dialog, [contenteditable], [role="button"], [role="slider"], [tabindex]:not([tabindex="-1"])'

const dragsWindow = (event: MouseEvent) => {
  if (event.button !== 0 || !(event.target instanceof Element)) return false
  if (event.target.closest(interactive)) return false
  return event.clientY < dragStripHeight || Boolean(event.target.closest('[data-window-drag]'))
}

const Controls = ({ invoke }: { invoke: TauriInternals['invoke'] }) => {
  const { t } = useTranslation()
  const [maximized, setMaximized] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)

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

  // The window has no native frame (§28.4): its top strip and the regions
  // marked `data-window-drag` move it, a double click maximizes it.
  useEffect(() => {
    const press = (event: MouseEvent) => {
      if (event.detail > 2 || !dragsWindow(event)) return
      event.preventDefault()
      const command = event.detail === 2 ? 'internal_toggle_maximize' : 'start_dragging'
      void invoke(`plugin:window|${command}`).catch(() => undefined)
    }
    document.addEventListener('mousedown', press)
    return () => document.removeEventListener('mousedown', press)
  }, [invoke])

  // Pages keep clear of the buttons through `--window-controls-inset`.
  useEffect(() => {
    document.documentElement.toggleAttribute('data-window-controls', !fullscreen)
    return () => document.documentElement.removeAttribute('data-window-controls')
  }, [fullscreen])

  if (fullscreen) return undefined
  const run = (command: string) => () =>
    void invoke(`plugin:window|${command}`).catch(() => undefined)
  return (
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
          {maximized ? <path d="M.5 2.5h7v7h-7zM2.5 2.5v-2h7v7h-2" /> : <path d="M.5.5h9v9h-9z" />}
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
  )
}

/** The desktop app's window buttons (§28.4); nothing in a browser. */
export const WindowControls = () => {
  const internals = tauriInternals()
  return internals === undefined ? undefined : <Controls invoke={internals.invoke} />
}
