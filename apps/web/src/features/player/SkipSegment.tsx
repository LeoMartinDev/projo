import { useTranslation } from 'react-i18next'

import type { SkippableSegment } from './segment-skip.ts'

const SkipIcon = ({ size }: { size: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    <path d="M6 6l6 6-6 6M13 6l6 6-6 6" />
  </svg>
)

/**
 * "Skip intro" / "Skip recap" (§12.4, artboard `Player`), bottom right: the label and
 * its 8 s bar, then only the icon (the label stays its accessible name).
 */
export const SkipSegmentButton = ({
  segment,
  phase,
  progress,
  onSkip,
}: {
  segment: SkippableSegment
  phase: 'full' | 'icon'
  progress: number
  onSkip: () => void
}) => {
  const { t } = useTranslation()
  return (
    <button
      type="button"
      className={`skip-segment${phase === 'icon' ? ' skip-segment--icon' : ''}`}
      onClick={onSkip}
    >
      <span className="skip-segment__body">
        <span className="skip-segment__label">
          {segment.type === 'intro' ? t('player.skip.intro') : t('player.skip.recap')}
        </span>
        <SkipIcon size={18} />
      </span>
      <span className="skip-segment__track" aria-hidden="true">
        <span className="skip-segment__fill" style={{ transform: `scaleX(${progress})` }} />
      </span>
    </button>
  )
}

/** "Intro skipped · Undo" (§10.7), bottom left where the track toast goes. */
export const SkippedToast = ({
  segment,
  onUndo,
}: {
  segment: SkippableSegment
  onUndo: () => void
}) => {
  const { t } = useTranslation()
  return (
    <div className="player-toast" role="status">
      <span className="player-toast__text">
        {segment.type === 'intro' ? t('player.skip.introSkipped') : t('player.skip.recapSkipped')}
      </span>
      <span className="player-toast__actions">
        <button type="button" className="player-toast__action" onClick={onUndo}>
          {t('common.cancel')}
        </button>
      </span>
    </div>
  )
}
