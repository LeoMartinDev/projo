import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { type KeyboardEvent, useEffect, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { ItemSummaryDto } from '@projo/shared/api/catalog'

import { Artwork } from '../../shared/ui/Artwork.tsx'
import { CloseIcon } from '../../shared/ui/icons.tsx'
import { SearchIcon } from '../../shared/ui/media-icons.tsx'
import { ErrorAlert } from '../../shared/ui/states.tsx'
import { useElement } from '../../shared/ui/use-element.ts'
import { searchQuery } from '../catalog/queries.ts'
import { posterOf, toneOf, yearsLabel } from '../media/media.ts'
import '../media/media.css'
import './search.css'

const debounceMs = 180

/** The query sent to the API, `debounceMs` after the last keystroke (§13.5 "instant"). */
const useDebounced = (value: string): string => {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), debounceMs)
    return () => clearTimeout(timer)
  }, [value])
  return debounced
}

const ResultRow = ({
  item,
  optionId,
  active,
  onPick,
  onHover,
}: {
  item: ItemSummaryDto
  optionId: string
  active: boolean
  onPick: () => void
  onHover: () => void
}) => (
  <li
    id={optionId}
    role="option"
    aria-selected={active}
    className="search-result"
    onClick={onPick}
    onPointerMove={onHover}
  >
    <span className={`search-result__poster tone-${toneOf(item.id)}`} aria-hidden="true">
      <Artwork src={posterOf(item)} className="cover-img" />
    </span>
    <span className="search-result__text">
      <span className="search-result__title">{item.title}</span>
      {item.year === undefined ? undefined : (
        <span className="search-result__meta">{yearsLabel(item)}</span>
      )}
    </span>
  </li>
)

/**
 * Search overlay (§13.2, §13.5): instant results from 2 characters, movies and series apart,
 * arrow keys move through the results (combobox), Enter opens one, Escape closes.
 */
export const SearchOverlay = ({ open, onClose }: { open: boolean; onClose: () => void }) => {
  const { t } = useTranslation()
  const [dialog, ref] = useElement<HTMLDialogElement>()

  useEffect(() => {
    if (dialog === undefined) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [dialog, open])

  return (
    <dialog
      ref={ref}
      className="search"
      aria-label={t('search.label')}
      // React propagates cancel and close up the tree: ignore those of a nested dialog.
      onClose={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
      onCancel={(event) => {
        if (event.target !== event.currentTarget) return
        event.preventDefault()
        onClose()
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      {open ? <SearchPanel onClose={onClose} /> : undefined}
    </dialog>
  )
}

const SearchPanel = ({ onClose }: { onClose: () => void }) => {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const listId = useId()
  const [text, setText] = useState('')
  const [active, setActive] = useState(0)
  const q = useDebounced(text.trim())
  const ready = q.length >= 2
  const search = useQuery({ ...searchQuery(q), placeholderData: keepPreviousData })
  const typing = text.trim() !== q
  const data = ready ? search.data : undefined
  const results: ItemSummaryDto[] = data === undefined ? [] : [...data.movies, ...data.series]
  const current = Math.min(active, Math.max(0, results.length - 1))
  const optionId = (index: number) => `${listId}-${index}`

  const pick = (item: ItemSummaryDto | undefined) => {
    if (item === undefined) return
    onClose()
    void navigate({ to: '/items/$itemId', params: { itemId: item.id } })
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (results.length === 0) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActive((current + 1) % results.length)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActive((current - 1 + results.length) % results.length)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      pick(results[current])
    }
  }

  const group = (kind: 'movies' | 'series', items: ItemSummaryDto[], offset: number) =>
    items.length === 0 ? undefined : (
      <div className="search__group" role="group" aria-labelledby={`${listId}-${kind}`}>
        <span id={`${listId}-${kind}`} className="search__group-title" role="presentation">
          {kind === 'movies' ? t('nav.movies') : t('nav.series')}
        </span>
        <ul className="search__list" role="presentation">
          {items.map((item, index) => (
            <ResultRow
              key={item.id}
              item={item}
              optionId={optionId(offset + index)}
              active={offset + index === current}
              onPick={() => pick(item)}
              onHover={() => setActive(offset + index)}
            />
          ))}
        </ul>
      </div>
    )

  return (
    <div className="search__panel">
      <div className="search__bar">
        <span className="search__icon" aria-hidden="true">
          <SearchIcon size={22} />
        </span>
        <input
          className="search__input"
          type="search"
          role="combobox"
          aria-label={t('search.label')}
          aria-expanded={results.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={results.length > 0 ? optionId(current) : undefined}
          placeholder={t('search.placeholder')}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="search"
          autoFocus
          value={text}
          onChange={(event) => {
            setText(event.target.value)
            setActive(0)
          }}
          onKeyDown={onKeyDown}
        />
        {search.isFetching || typing ? (
          <span className="spinner search__spinner" aria-hidden="true" />
        ) : undefined}
        <button
          type="button"
          className="icon-button"
          aria-label={t('common.close')}
          onClick={onClose}
        >
          <CloseIcon />
        </button>
      </div>
      <div className="search__results" id={listId} role="listbox" aria-label={t('search.results')}>
        {!ready ? (
          <p className="search__hint">{t('search.hint')}</p>
        ) : search.isError ? (
          <ErrorAlert error={search.error} />
        ) : data === undefined ? (
          <div className="search__columns" aria-hidden="true">
            {[0, 1].map((column) => (
              <div key={column} className="search__group">
                {[0, 1, 2].map((row) => (
                  <span key={row} className="skeleton search__skeleton" />
                ))}
              </div>
            ))}
          </div>
        ) : results.length === 0 ? (
          <p className="search__hint" role="status">
            {t('search.empty', { query: q })}
          </p>
        ) : (
          <div className="search__columns">
            {group('movies', data.movies, 0)}
            {group('series', data.series, data.movies.length)}
          </div>
        )}
      </div>
    </div>
  )
}
