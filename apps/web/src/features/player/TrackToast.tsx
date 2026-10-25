import { useTranslation } from 'react-i18next'

import type { TrackToast as TrackToastState } from './track-memory.ts'

/**
 * Toast of a manual track change (§11.3), bottom left like "Intro skipped · Undo" in the
 * artboard `Player`: "Applied to the whole show" (or "to the movie"), "Set as default for my
 * profil", "Undo". Then a short confirmation.
 */
export const TrackToast = ({
  toast,
  canSetDefault,
  onSetDefault,
  onUndo,
}: {
  toast: TrackToastState
  canSetDefault: boolean
  onSetDefault: () => void
  onUndo: () => void
}) => {
  const { t } = useTranslation()
  const message =
    toast.status === 'defaulted'
      ? t('player.memory.defaulted')
      : toast.status === 'undone'
        ? t('player.memory.undone')
        : toast.status === 'failed'
          ? t('player.memory.failed')
          : toast.scope === 'series'
            ? t('player.memory.series')
            : t('player.memory.movie')
  const actionable = toast.status === 'applied' || toast.status === 'defaulting'
  return (
    <div key={toast.id} className="player-toast" role="status">
      <span className="player-toast__text">{message}</span>
      {actionable ? (
        <span className="player-toast__actions">
          {canSetDefault ? (
            <button
              type="button"
              className="player-toast__action"
              disabled={toast.status === 'defaulting'}
              onClick={onSetDefault}
            >
              {t('player.memory.setDefault')}
            </button>
          ) : undefined}
          <button
            type="button"
            className="player-toast__action"
            disabled={toast.status === 'defaulting'}
            onClick={onUndo}
          >
            {t('common.cancel')}
          </button>
        </span>
      ) : undefined}
    </div>
  )
}
