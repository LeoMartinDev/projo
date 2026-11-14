import { useRouterState } from '@tanstack/react-router'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import './update-banner.css'

import { useDesktopUpdate } from '../desktop/use-desktop-update.ts'
import { isPlayerPath, useAppUpdate } from './use-app-update.ts'

// The server's new version first (a reload), then the desktop app's (a restart, §28.10).
export const UpdateBanner = () => {
  const { t } = useTranslation()
  const playing = useRouterState({ select: (state) => isPlayerPath(state.location.pathname) })
  const { offered, apply } = useAppUpdate()
  const desktop = useDesktopUpdate()
  const [applying, setApplying] = useState(false)
  if (playing) return undefined
  const banner = offered
    ? { text: t('app.update.available'), action: t('app.update.reload'), run: apply }
    : desktop.ready === undefined
      ? undefined
      : {
          text: t('app.update.desktopReady'),
          action: t('app.update.restart'),
          run: () => void desktop.install().catch(() => setApplying(false)),
        }
  if (banner === undefined) return undefined
  return (
    <div className="update-banner" role="status">
      <span className="update-banner__text">{banner.text}</span>
      <button
        type="button"
        className="update-banner__action"
        disabled={applying}
        onClick={() => {
          setApplying(true)
          banner.run()
        }}
      >
        {banner.action}
      </button>
    </div>
  )
}
