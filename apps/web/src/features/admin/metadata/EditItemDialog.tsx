import { useQuery } from '@tanstack/react-query'
import { type ChangeEvent, type FormEvent, type ReactNode, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { type GenreId, genreIds } from '@projo/shared/api/genres'
import {
  type EditableField,
  type EditableImageKind,
  type ItemMetadataDto,
  maxImageUploadBytes,
} from '@projo/shared/api/metadata'

import { apiFailure } from '../../../shared/api/failure.ts'
import { genreLabel, sortGenresByLabel } from '../../../shared/i18n/genres.ts'
import { currentLocale } from '../../../shared/i18n/index.ts'
import { Field } from '../../../shared/ui/controls.tsx'
import { Dialog } from '../../../shared/ui/Dialog.tsx'
import { LockSmallIcon, RestartIcon } from '../../../shared/ui/media-icons.tsx'
import { ErrorAlert, ErrorState } from '../../../shared/ui/states.tsx'
import { tmdbPosterUrl } from '../identify/queries.ts'
import { changesOf, formOf, type MetadataForm, toggleGenre } from './editing.ts'
import {
  imageAlternativesQuery,
  itemMetadataQuery,
  useChooseImage,
  useRefreshItem,
  useRemoveOverride,
  useUpdateItemMetadata,
  useUploadImage,
} from './queries.ts'
import './editing.css'

type Tab = 'details' | EditableImageKind
const tabs: readonly Tab[] = ['details', 'poster', 'backdrop']

/** "Back to the TMDB value" (or, on a local item, the lock alone) at the end of a locked field. */
const LockTrail = ({
  item,
  field,
  pending,
  onRevert,
}: {
  item: ItemMetadataDto
  field: EditableField
  pending: boolean
  onRevert: (field: EditableField) => void
}) => {
  const { t } = useTranslation()
  if (!item.locked.includes(field)) return undefined
  const label = item.tmdbId === undefined ? t('admin.editItem.unlock') : t('admin.editItem.revert')
  return (
    <span className="edit-item__lock">
      <span className="edit-item__lock-icon" role="img" aria-label={t('admin.editItem.locked')}>
        <LockSmallIcon />
      </span>
      <button
        type="button"
        className="icon-button edit-item__revert"
        aria-label={label}
        title={label}
        disabled={pending}
        onClick={() => onRevert(field)}
      >
        <RestartIcon size={16} />
      </button>
    </span>
  )
}

/** §9.3: genres picked from the fixed list (§9.1), sorted by label; a pressed toggle = picked. */
const GenrePicker = ({
  id,
  selected,
  onToggle,
  trail,
}: {
  id: string
  selected: readonly GenreId[]
  onToggle: (genre: GenreId) => void
  trail: ReactNode
}) => {
  const { t } = useTranslation()
  const options = sortGenresByLabel(t, genreIds, currentLocale())
  return (
    <div className="edit-item__genres" role="group" aria-labelledby={`${id}-label`}>
      <div className="edit-item__genres-head">
        <span id={`${id}-label`} className="field__label">
          {t('admin.editItem.fields.genres')}
        </span>
        {trail}
      </div>
      <div className="edit-item__genre-list">
        {options.map((genre) => (
          <button
            key={genre}
            type="button"
            className="button button--glass button--small edit-item__genre"
            aria-pressed={selected.includes(genre)}
            onClick={() => onToggle(genre)}
          >
            {genreLabel(t, genre)}
          </button>
        ))}
      </div>
    </div>
  )
}

const DetailsForm = ({
  formId,
  item,
  onSaved,
}: {
  formId: string
  item: ItemMetadataDto
  onSaved: () => void
}) => {
  const { t } = useTranslation()
  const ids = useId()
  const [form, setForm] = useState<MetadataForm>(() => formOf(item))
  const [shown, setShown] = useState(false)
  const update = useUpdateItemMetadata(item.id)
  const revert = useRemoveOverride(item.id)
  const { problems } = changesOf(form, item)

  const set =
    (key: 'title' | 'year' | 'overview') =>
    (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((current) => ({ ...current, [key]: event.target.value }))

  const onRevert = (field: EditableField) =>
    revert.mutate(field, {
      onSuccess: (next) => {
        const fresh = formOf(next)
        if (field === 'title' || field === 'year' || field === 'overview') {
          setForm((current) => ({ ...current, [field]: fresh[field] }))
        }
        if (field === 'genres') setForm((current) => ({ ...current, genres: fresh.genres }))
      },
    })

  const submit = (event: FormEvent) => {
    event.preventDefault()
    setShown(true)
    const { body, problems: found } = changesOf(form, item)
    if (found.length > 0) return
    if (body === undefined) return onSaved()
    update.mutate(body, { onSuccess: onSaved })
  }

  const trail = (field: EditableField): ReactNode => (
    <LockTrail item={item} field={field} pending={revert.isPending} onRevert={onRevert} />
  )

  return (
    <form id={formId} className="edit-item__scroll edit-item__form" onSubmit={submit} noValidate>
      <div className="edit-item__row">
        <Field
          id={`${ids}-title`}
          label={t('admin.editItem.fields.title')}
          invalid={shown && problems.includes('title')}
          trail={trail('title')}
        >
          <input
            id={`${ids}-title`}
            className="field__input"
            value={form.title}
            maxLength={500}
            autoComplete="off"
            onChange={set('title')}
          />
        </Field>
        <Field
          id={`${ids}-year`}
          label={t('admin.editItem.fields.year')}
          invalid={shown && problems.includes('year')}
          trail={trail('year')}
        >
          <input
            id={`${ids}-year`}
            className="field__input mono"
            inputMode="numeric"
            value={form.year}
            maxLength={4}
            autoComplete="off"
            onChange={set('year')}
          />
        </Field>
      </div>
      <GenrePicker
        id={`${ids}-genres`}
        selected={form.genres}
        onToggle={(genre) =>
          setForm((current) => ({ ...current, genres: toggleGenre(current.genres, genre) }))
        }
        trail={trail('genres')}
      />
      <div className="field edit-item__overview">
        <div className="field__stack">
          <label className="field__label" htmlFor={`${ids}-overview`}>
            {t('admin.editItem.fields.overview')}
          </label>
          <textarea
            id={`${ids}-overview`}
            className="field__input edit-item__textarea"
            value={form.overview}
            maxLength={10_000}
            rows={7}
            onChange={set('overview')}
          />
        </div>
        {trail('overview')}
      </div>
      {update.isError ? <ErrorAlert error={update.error} /> : undefined}
      {revert.isError ? <ErrorAlert error={revert.error} /> : undefined}
    </form>
  )
}

/** Grid of TMDB alternatives (stable size, scrolls inside) and the upload of an image. */
const ImagePicker = ({ item, kind }: { item: ItemMetadataDto; kind: EditableImageKind }) => {
  const { t } = useTranslation()
  const alternatives = useQuery(imageAlternativesQuery(item.id, kind))
  const choose = useChooseImage(item.id)
  const upload = useUploadImage(item.id)
  const revert = useRemoveOverride(item.id)
  const [tooLarge, setTooLarge] = useState(false)
  const [choosing, setChoosing] = useState<string | undefined>(undefined)
  const busy = choose.isPending || upload.isPending || revert.isPending
  const current = item.images[kind]
  const listed = alternatives.data?.items ?? []
  const currentListed = listed.some((image) => image.current)
  const error = choose.isError
    ? choose.error
    : upload.isError
      ? upload.error
      : revert.isError
        ? revert.error
        : undefined

  const onFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (file === undefined) return
    choose.reset()
    revert.reset()
    if (file.size > maxImageUploadBytes) {
      setTooLarge(true)
      return
    }
    setTooLarge(false)
    upload.mutate({ kind, file })
  }

  const pick = (tmdbPath: string) => {
    upload.reset()
    revert.reset()
    setTooLarge(false)
    setChoosing(tmdbPath)
    choose.mutate({ kind, tmdbPath }, { onSettled: () => setChoosing(undefined) })
  }

  const notMatched = alternatives.isError && alternatives.error.code === 'metadata/not_matched'

  return (
    <div className="edit-item__images">
      <div className="edit-item__image-actions">
        {/* The label is the button: no ref needed to open the file chooser. */}
        <label
          className="button button--glass button--small edit-item__upload"
          data-disabled={busy}
        >
          {upload.isPending ? <span className="spinner" aria-hidden="true" /> : undefined}
          {t('admin.editItem.upload')}
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="visually-hidden"
            disabled={busy}
            onChange={onFile}
          />
        </label>
        {item.locked.includes(kind) ? (
          <button
            type="button"
            className="button button--small"
            disabled={busy}
            onClick={() => {
              choose.reset()
              upload.reset()
              revert.mutate(kind)
            }}
          >
            <RestartIcon size={16} />
            {item.tmdbId === undefined ? t('admin.editItem.unlock') : t('admin.editItem.revert')}
          </button>
        ) : undefined}
      </div>
      {tooLarge ? (
        <ErrorAlert error={apiFailure(413, 'image/too_large', '')} />
      ) : error === undefined ? undefined : (
        <ErrorAlert error={error} />
      )}
      <div className={`edit-item__scroll well edit-item__grid edit-item__grid--${kind}`}>
        {alternatives.isPending ? (
          Array.from({ length: kind === 'poster' ? 8 : 4 }, (_, index) => (
            <span key={index} className="skeleton edit-item__tile" aria-hidden="true" />
          ))
        ) : (
          <>
            {current !== undefined && !currentListed ? (
              <div className="edit-item__tile" aria-current="true">
                <img src={current} alt={t('admin.editItem.current')} loading="lazy" />
              </div>
            ) : undefined}
            {listed.map((image) => (
              <button
                key={image.tmdbPath}
                type="button"
                className="edit-item__tile"
                aria-pressed={image.current}
                aria-label={t('admin.editItem.chooseImage', {
                  size: `${image.width} × ${image.height}`,
                })}
                disabled={busy}
                onClick={() => pick(image.tmdbPath)}
              >
                <img
                  src={`${tmdbPosterUrl(image.tmdbPath)}${kind === 'backdrop' ? '?size=w300' : ''}`}
                  alt=""
                  loading="lazy"
                />
                {image.language === undefined ? undefined : (
                  <span className="edit-item__tile-badge">{image.language.toUpperCase()}</span>
                )}
                {choosing === image.tmdbPath ? (
                  <span className="edit-item__tile-busy">
                    <span className="spinner" aria-hidden="true" />
                  </span>
                ) : undefined}
              </button>
            ))}
            {alternatives.isError && !notMatched ? (
              <div className="edit-item__grid-state">
                <ErrorState
                  error={alternatives.error}
                  onRetry={() => void alternatives.refetch()}
                />
              </div>
            ) : listed.length === 0 && (current === undefined || currentListed) ? (
              <p className="edit-item__grid-state">{t('admin.editItem.noAlternatives')}</p>
            ) : undefined}
          </>
        )}
      </div>
    </div>
  )
}

/** "Refresh" (§9.4): a job; the page follows when it ends (`catalog.changed`). */
const RefreshButton = ({ itemId }: { itemId: string }) => {
  const { t } = useTranslation()
  const refresh = useRefreshItem()
  return (
    <button
      type="button"
      className="button button--glass edit-item__refresh"
      disabled={refresh.isPending || refresh.isSuccess}
      onClick={() => refresh.mutate(itemId)}
    >
      {refresh.isPending ? <span className="spinner" aria-hidden="true" /> : undefined}
      {refresh.isSuccess ? t('admin.editItem.refreshQueued') : t('admin.editItem.refresh')}
    </button>
  )
}

/**
 * Metadata editor of an item (§9.3, admin): title, year, genres, overview, poster, backdrop.
 * Each saved field is locked against refreshes; "Back to the TMDB value" removes the lock. Images apply
 * as soon as they are picked. A fixed-height dialog: each tab scrolls inside.
 */
export const EditItemDialog = ({
  itemId,
  name,
  open,
  onClose,
}: {
  itemId: string
  /** Season or episode label, in the title. */
  name?: string
  open: boolean
  onClose: () => void
}) => {
  const { t } = useTranslation()
  const formId = useId()
  const [tab, setTab] = useState<Tab>('details')
  const item = useQuery({ ...itemMetadataQuery(itemId), enabled: open })

  const close = () => {
    setTab('details')
    onClose()
  }

  return (
    <Dialog
      open={open}
      fill
      title={name === undefined ? t('admin.editItem.title') : t('admin.editItem.titleOf', { name })}
      onClose={close}
      footer={
        <>
          {item.data?.tmdbId === undefined ? undefined : <RefreshButton itemId={itemId} />}
          <button type="button" className="button" onClick={close}>
            {tab === 'details' ? t('common.cancel') : t('common.close')}
          </button>
          {tab === 'details' ? (
            <button
              type="submit"
              form={formId}
              className="button button--primary"
              disabled={item.data === undefined}
            >
              {t('common.save')}
            </button>
          ) : undefined}
        </>
      }
    >
      <div className="edit-item">
        <div
          className="seg seg--3 edit-item__tabs"
          role="tablist"
          aria-label={t('admin.editItem.title')}
          data-active={tabs.indexOf(tab)}
        >
          <span className="seg__indicator" aria-hidden="true" />
          {tabs.map((value) => (
            <button
              key={value}
              type="button"
              role="tab"
              className="seg__option"
              aria-selected={tab === value}
              aria-pressed={tab === value}
              onClick={() => setTab(value)}
            >
              {t(`admin.editItem.tabs.${value}`)}
            </button>
          ))}
        </div>
        {item.isError ? (
          <div className="edit-item__scroll">
            <ErrorState error={item.error} onRetry={() => void item.refetch()} />
          </div>
        ) : item.isPending ? (
          <div className="edit-item__scroll" aria-busy="true">
            <span className="skeleton edit-item__skeleton" />
          </div>
        ) : tab === 'details' ? (
          <DetailsForm key={item.data.id} formId={formId} item={item.data} onSaved={close} />
        ) : (
          <ImagePicker key={tab} item={item.data} kind={tab} />
        )}
      </div>
    </Dialog>
  )
}
