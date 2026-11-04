import { useRouterState } from '@tanstack/react-router'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import './update-banner.css'

import { isPlayerPath, useAppUpdate } from './use-app-update.ts'

export const UpdateBanner = () => {
  const { t } = useTranslation()
  const playing = useRouterState({ select: (state) => isPlayerPath(state.location.pathname) })
  const { offered, apply } = useAppUpdate()
  const [applying, setApplying] = useState(false)
  if (!offered || playing) return undefined
  return (
    <div className="update-banner" role="status">
      <span className="update-banner__text">{t('app.update.available')}</span>
      <button
        type="button"
        className="update-banner__action"
        disabled={applying}
        onClick={() => {
          setApplying(true)
          apply()
        }}
      >
        {t('app.update.reload')}
      </button>
    </div>
  )
}
