import { useRouterState } from '@tanstack/react-router'
import { useState, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'

import './update-banner.css'

import { isPlayerPath } from '../../features/player/player-path.ts'
import { useHost } from '../../host.ts'

// What the host's update source offers (§16.4): reload on the server's new web app, or restart
// on the desktop app's new version (§28.10). Never over the player.
export const UpdateBanner = () => {
  const { t } = useTranslation()
  const { updates } = useHost()
  const playing = useRouterState({ select: (state) => isPlayerPath(state.location.pathname) })
  const offered = useSyncExternalStore(updates.subscribe, updates.offered)
  const [applying, setApplying] = useState(false)
  if (playing || offered === undefined) return undefined
  const [text, action] =
    offered === 'reload'
      ? [t('app.update.available'), t('app.update.reload')]
      : [t('app.update.desktopReady'), t('app.update.restart')]
  return (
    <div className="update-banner" role="status">
      <span className="update-banner__text">{text}</span>
      <button
        type="button"
        className="update-banner__action"
        disabled={applying}
        onClick={() => {
          setApplying(true)
          updates.apply().catch(() => setApplying(false))
        }}
      >
        {action}
      </button>
    </div>
  )
}
