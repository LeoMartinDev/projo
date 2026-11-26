import type { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'

import type { CatalogFilesDto, EditableField } from '@projo/shared/api/metadata'

import { formatNumber } from '../../../shared/format/format.ts'
import { currentLocale } from '../../../shared/i18n/index.ts'
import { Artwork } from '../../../shared/ui/Artwork.tsx'
import { FilmIcon, TvIcon } from '../../../shared/ui/icons.tsx'
import { LockSmallIcon } from '../../../shared/ui/media-icons.tsx'

const fieldLabel = (t: TFunction, field: EditableField): string =>
  field === 'poster' || field === 'backdrop'
    ? t(`admin.editItem.tabs.${field}`)
    : t(`admin.editItem.fields.${field}`)

/** A lock beside a title whose fields an admin edited (§9.3), naming them. */
export const EditedMark = ({ locked }: { locked: readonly EditableField[] }) => {
  const { t } = useTranslation()
  if (locked.length === 0) return undefined
  const label = t('admin.catalogue.edited', {
    fields: locked.map((field) => fieldLabel(t, field)).join(', '),
  })
  return (
    <span className="cat-edited" role="img" aria-label={label} title={label}>
      <LockSmallIcon />
    </span>
  )
}

/** The files of a title: "No file" when none plays, the missing ones after the others. */
export const FilesCount = ({ files }: { files: CatalogFilesDto }) => {
  const { t } = useTranslation()
  const locale = currentLocale()
  const missing =
    files.missing === 0
      ? undefined
      : t('admin.counts.missing', {
          count: files.missing,
          formatted: formatNumber(files.missing, locale),
        })
  return (
    <span className="cat-files">
      {files.ready === 0 ? (
        <span className="acc-pill acc-pill--off">{t('admin.catalogue.noFile')}</span>
      ) : (
        <span>
          {t('admin.counts.ready', {
            count: files.ready,
            formatted: formatNumber(files.ready, locale),
          })}
        </span>
      )}
      {missing === undefined ? undefined : <span className="adm-muted">{missing}</span>}
    </span>
  )
}

export const PosterThumb = ({
  src,
  kind,
  size = 'small',
}: {
  src: string | undefined
  kind: 'movie' | 'series'
  size?: 'small' | 'large'
}) => (
  <span className={`cat-poster cat-poster--${size}`} aria-hidden="true">
    <Artwork
      src={src}
      className="cat-poster__image"
      sizes={size === 'small' ? '40px' : '120px'}
      fallback={kind === 'movie' ? <FilmIcon size={16} /> : <TvIcon size={16} />}
    />
  </span>
)
