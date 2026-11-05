import { useTranslation } from 'react-i18next'

import { StarIcon } from '../../shared/ui/media-icons.tsx'
import './media.css'

export const Score = ({ score }: { score: string | undefined }) => {
  const { t } = useTranslation()
  if (score === undefined) return undefined
  const label = t('card.score', { score })
  return (
    <span className="score" title={label}>
      <StarIcon />
      <span aria-hidden="true">{score}</span>
      <span className="visually-hidden">{label}</span>
    </span>
  )
}
