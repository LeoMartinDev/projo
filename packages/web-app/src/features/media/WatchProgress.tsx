import { useTranslation } from 'react-i18next'

import { currentLocale } from '../../shared/i18n/index.ts'
import { formatRemaining } from './media.ts'
import './media.css'

/** "S1 · E2 “Whiteout”", the bar, "18 min left": the progress line of the heroes. */
export const WatchProgress = ({
  ratio,
  remainingMs,
  episode,
  className,
}: {
  ratio: number
  remainingMs?: number | undefined
  episode?: string | undefined
  className?: string
}) => {
  const { t } = useTranslation()
  const locale = currentLocale()
  return (
    <div className={className === undefined ? 'watch-progress' : `watch-progress ${className}`}>
      {episode === undefined ? undefined : (
        <span className="watch-progress__episode">{episode}</span>
      )}
      <progress
        className="bar watch-progress__bar"
        value={ratio}
        max={1}
        aria-label={t('catalog.inProgress')}
      />
      {remainingMs === undefined ? undefined : (
        <span className="watch-progress__remaining">
          {t('item.remaining', { duration: formatRemaining(remainingMs, locale) })}
        </span>
      )}
    </div>
  )
}
