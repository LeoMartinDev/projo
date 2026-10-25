import { useTranslation } from 'react-i18next'

import {
  type AvatarColor,
  type ContentRatingTier,
  contentRatingTiers,
} from '@projo/shared/api/profiles'

/** Order of the artboard `AdminAccounts`: Bleu, Terre cuite, Sauge, Violet, Ardoise, Miel. */
export const avatarColors: readonly AvatarColor[] = [
  'blue',
  'terracotta',
  'sage',
  'violet',
  'slate',
  'honey',
]

/** Profile avatar of the admin: the initial on a colored tile (§14), artboard sizes. */
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

/** Six swatches, radio group (artboard `AdminAccounts`, "Couleur"). */
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

/** Highest tier first, as in the artboard: Sans limite, 18, 16, 12, 10, Tous publics. */
export const ratingOptions: readonly ContentRatingTier[] = contentRatingTiers.toReversed()

export const useRatingLabel = () => {
  const { t } = useTranslation()
  return (tier: ContentRatingTier | undefined): string =>
    tier === undefined ? t('admin.accounts.rating.none') : t(`admin.accounts.rating.${tier}`)
}
