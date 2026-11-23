import { useTranslation } from 'react-i18next'

import {
  type AvatarColor,
  type ContentRatingTier,
  contentRatingTiers,
} from '@projo/shared/api/profiles'

import type { SummaryLabels } from './summary.ts'

export const avatarColors: readonly AvatarColor[] = [
  'blue',
  'terracotta',
  'sage',
  'violet',
  'slate',
  'honey',
]

export const AdminAvatar = ({
  name,
  color,
  size = 'medium',
}: {
  name: string
  color: AvatarColor | 'neutral'
  size?: 'small' | 'medium' | 'large'
}) => (
  <span className={`acc-avatar acc-avatar--${size} acc-avatar--${color}`} aria-hidden="true">
    {(name.trim()[0] ?? '?').toLocaleUpperCase()}
  </span>
)

export const ColorPicker = ({
  value,
  labelId,
  onChange,
}: {
  value: AvatarColor
  labelId: string
  onChange: (color: AvatarColor) => void
}) => {
  const { t } = useTranslation()
  return (
    <div className="acc-swatches" role="radiogroup" aria-labelledby={labelId}>
      {avatarColors.map((color) => (
        <button
          key={color}
          type="button"
          role="radio"
          className={`acc-swatch acc-avatar--${color}`}
          aria-checked={value === color}
          aria-label={t(`admin.accounts.colors.${color}`)}
          onClick={() => onChange(color)}
        />
      ))}
    </div>
  )
}

export const ratingOptions: readonly ContentRatingTier[] = contentRatingTiers.toReversed()

export const useRatingLabel = () => {
  const { t } = useTranslation()
  return (tier: ContentRatingTier | undefined): string =>
    tier === undefined ? t('admin.accounts.rating.none') : t(`admin.accounts.rating.${tier}`)
}

/** The labels of a profile's summary ("Movies, Shows · 16 and over · PIN", `profileSummary`). */
export const useSummaryLabels = (): SummaryLabels => {
  const { t } = useTranslation()
  const ratingLabel = useRatingLabel()
  return {
    allLibraries: t('admin.accounts.allLibraries'),
    noLibrary: t('admin.accounts.noLibrary'),
    noLimit: t('admin.accounts.noLimit'),
    rating: ratingLabel,
    pin: t('admin.accounts.pinSummary'),
  }
}
