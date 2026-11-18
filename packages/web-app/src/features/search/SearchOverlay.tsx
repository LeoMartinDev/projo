import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { type KeyboardEvent, type ReactNode, useEffect, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { ItemSummaryDto } from '@projo/shared/api/catalog'
import {
  isSearchable,
  type SearchChannelDto,
  type SearchProgrammeDto,
} from '@projo/shared/api/search'

import { Artwork } from '../../shared/ui/Artwork.tsx'
import { CloseIcon } from '../../shared/ui/icons.tsx'
import { SearchIcon } from '../../shared/ui/media-icons.tsx'
import { ErrorAlert } from '../../shared/ui/states.tsx'
import { useElement } from '../../shared/ui/use-element.ts'
import { useNow } from '../../shared/ui/use-now.ts'
import { searchQuery } from '../catalog/queries.ts'
import { posterOf, toneOf, yearsLabel } from '../media/media.ts'
import { ChannelLogo } from '../tv/ChannelLogo.tsx'
import { programmeTimes } from '../tv/guide-format.ts'
import { ProgrammeDialog } from '../tv/ProgrammeDialog.tsx'
import { episodeLine } from '../tv/programme-format.ts'
import { tvChannelsQuery } from '../tv/queries.ts'
import { moveInGrid } from './result-grid.ts'
import {
  channelLabel,
  isOnAir,
  type SearchEntry,
  type SearchSectionId,
  searchSections,
} from './search-sections.ts'
import '../media/media.css'
import './search.css'

const debounceMs = 180

const useDebounced = (value: string): string => {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), debounceMs)
    return () => clearTimeout(timer)
  }, [value])
  return debounced
}

/** Whether the profile lists channels (§29.7): the search then names them (§29.6). */
const useHasChannels = () => (useQuery(tvChannelsQuery).data?.items.length ?? 0) > 0

type RowProps = {
  optionId: string
  active: boolean
  onPick: () => void
  onHover: () => void
}

const Row = ({
  optionId,
  active,
  onPick,
  onHover,
  art,
  children,
}: RowProps & { art: ReactNode; children: ReactNode }) => (
  <li
    id={optionId}
    role="option"
    aria-selected={active}
    className="search-result"
    onClick={onPick}
    onPointerMove={onHover}
  >
    {art}
    <span className="search-result__text">{children}</span>
  </li>
)

const ItemRow = ({ item, ...row }: RowProps & { item: ItemSummaryDto }) => (
  <Row
    {...row}
    art={
      <span className={`search-result__poster tone-${toneOf(item.id)}`} aria-hidden="true">
        <Artwork src={posterOf(item)} className="cover-img" />
      </span>
    }
  >
    <span className="search-result__title">{item.title}</span>
    {item.year === undefined ? undefined : (
      <span className="search-result__meta">{yearsLabel(item)}</span>
    )}
  </Row>
)

/** A channel's logo on a 16:9 tile, its name in its place without one (§29.6). */
const LogoTile = ({ channel }: { channel: SearchChannelDto }) => (
  <span className="search-result__logo" aria-hidden="true">
    <ChannelLogo
      channel={channel}
      className="search-result__logo-img"
      fallback={<span className="search-result__logo-name">{channel.name}</span>}
    />
  </span>
)

const ChannelRow = ({ channel, ...row }: RowProps & { channel: SearchChannelDto }) => {
  const { t } = useTranslation()
  return (
    <Row {...row} art={<LogoTile channel={channel} />}>
      <span className="search-result__title">{channel.name}</span>
      {channel.number === undefined ? undefined : (
        <span className="search-result__meta">
          {t('search.channelNumber', { number: channel.number })}
        </span>
      )}
    </Row>
  )
}

const ProgrammeRow = ({
  programme,
  at,
  ...row
}: RowProps & { programme: SearchProgrammeDto; at: number }) => {
  const { t } = useTranslation()
  const episode = episodeLine(t, programme)
  return (
    <Row {...row} art={<LogoTile channel={programme.channel} />}>
      <span className="search-result__title">{programme.title}</span>
      <span className="search-result__meta">
        {[channelLabel(programme.channel), episode]
          .filter((part) => part !== undefined)
          .join(' · ')}
      </span>
      <span className="search-result__meta">
        {isOnAir(programme, at) ? (
          <span className="search-result__on-air">{t('search.onNow')}</span>
        ) : undefined}
        {programmeTimes(programme.startAt, programme.endAt, at)}
      </span>
    </Row>
  )
}

export const SearchOverlay = ({ open, onClose }: { open: boolean; onClose: () => void }) => {
  const { t } = useTranslation()
  const [dialog, ref] = useElement<HTMLDialogElement>()
  const hasChannels = useHasChannels()

  useEffect(() => {
    if (dialog === undefined) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [dialog, open])

  return (
    <dialog
      ref={ref}
      className="search"
      aria-label={hasChannels ? t('search.labelTv') : t('search.label')}
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

const sectionTitleKeys = {
  movies: 'nav.movies',
  series: 'nav.series',
  channels: 'search.channels',
  programmes: 'search.programmes',
} as const satisfies Record<SearchSectionId, string>

const SearchPanel = ({ onClose }: { onClose: () => void }) => {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const listId = useId()
  const [input, inputRef] = useElement<HTMLInputElement>()
  const [text, setText] = useState('')
  const [active, setActive] = useState(0)
  // The programme whose detail is open over the search (§29.6).
  const [detail, setDetail] = useState<{ programme: SearchProgrammeDto; watch: boolean }>()
  const at = useNow().getTime()
  const channels = useQuery(tvChannelsQuery).data
  const hasChannels = (channels?.items.length ?? 0) > 0
  const q = useDebounced(text.trim())
  const ready = isSearchable(q)
  const search = useQuery({ ...searchQuery(q), placeholderData: keepPreviousData })
  const typing = text.trim() !== q
  const data = ready ? search.data : undefined
  const sections = data === undefined ? [] : searchSections(data)
  const results: SearchEntry[] = sections.flatMap((section) => section.entries)
  const current = Math.min(active, Math.max(0, results.length - 1))
  const optionId = (index: number) => `${listId}-${index}`

  const pick = (entry: SearchEntry | undefined) => {
    if (entry === undefined) return
    if (entry.kind === 'programme') {
      setDetail({ programme: entry.programme, watch: isOnAir(entry.programme, at) })
      return
    }
    onClose()
    if (entry.kind === 'channel')
      void navigate({ to: '/watch/tv/$channelId', params: { channelId: entry.channel.id } })
    else void navigate({ to: '/items/$itemId', params: { itemId: entry.item.id } })
  }

  // Each section's column count as laid out (the programmes' grid is wider).
  const columns = () =>
    sections.map((section) => {
      const list = document
        .getElementById(listId)
        ?.querySelector(`.search__list[data-section="${section.id}"]`)
      return list ? getComputedStyle(list).gridTemplateColumns.split(' ').length : 1
    })

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (results.length === 0) return
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      setActive(
        moveInGrid({
          sizes: sections.map((section) => section.entries.length),
          columns: columns(),
          current,
          direction: event.key === 'ArrowDown' ? 'down' : 'up',
        }),
      )
    } else if (event.key === 'Enter') {
      event.preventDefault()
      pick(results[current])
    }
  }

  const rowOf = (entry: SearchEntry, index: number) => {
    const row = {
      optionId: optionId(index),
      active: index === current,
      onPick: () => pick(entry),
      onHover: () => setActive(index),
    }
    switch (entry.kind) {
      case 'item':
        return <ItemRow key={entry.item.id} item={entry.item} {...row} />
      case 'channel':
        return <ChannelRow key={entry.channel.id} channel={entry.channel} {...row} />
      case 'programme':
        return (
          <ProgrammeRow key={entry.programme.id} programme={entry.programme} at={at} {...row} />
        )
    }
  }

  const groups = sections.map((section, position) => {
    const offset = sections.slice(0, position).reduce((sum, { entries }) => sum + entries.length, 0)
    return section.entries.length === 0 ? undefined : (
      <div
        key={section.id}
        className="search__group"
        role="group"
        aria-labelledby={`${listId}-${section.id}`}
      >
        <span id={`${listId}-${section.id}`} className="search__group-title" role="presentation">
          {t(sectionTitleKeys[section.id])}
        </span>
        <ul
          className={
            section.id === 'programmes' ? 'search__list search__list--wide' : 'search__list'
          }
          data-section={section.id}
          role="presentation"
        >
          {section.entries.map((entry, index) => rowOf(entry, offset + index))}
        </ul>
      </div>
    )
  })

  // Back from the detail, the search as it was: focus in its field (§29.6), once the detail is
  // gone (removing it would move focus to the page).
  const detailOpen = detail !== undefined
  useEffect(() => {
    if (!detailOpen) input?.focus()
  }, [detailOpen, input])

  return (
    <div className="search__panel">
      <div className="search__top">
        <div className="search__bar">
          <span className="search__icon" aria-hidden="true">
            <SearchIcon size={22} />
          </span>
          <input
            ref={inputRef}
            className="search__input"
            type="search"
            role="combobox"
            aria-label={hasChannels ? t('search.labelTv') : t('search.label')}
            aria-expanded={results.length > 0}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={results.length > 0 ? optionId(current) : undefined}
            placeholder={hasChannels ? t('search.placeholderTv') : t('search.placeholder')}
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
            className="icon-button search__close"
            aria-label={t('common.close')}
            onClick={onClose}
          >
            <CloseIcon />
          </button>
        </div>
        <button type="button" className="search__cancel" onClick={onClose}>
          {t('common.cancel')}
        </button>
      </div>
      <div className="search__results" id={listId} role="listbox" aria-label={t('search.results')}>
        {!ready ? undefined : search.isError ? (
          <ErrorAlert error={search.error} />
        ) : data === undefined ? (
          <div className="search__columns" aria-hidden="true">
            {[0, 1].map((column) => (
              <div key={column} className="search__group">
                <div className="search__list">
                  {[0, 1, 2].map((row) => (
                    <span key={row} className="skeleton search__skeleton" />
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : results.length === 0 ? (
          <p className="search__hint" role="status">
            {t('search.empty', { query: q })}
          </p>
        ) : (
          <div className="search__columns">{groups}</div>
        )}
      </div>
      {detail === undefined ? undefined : (
        <ProgrammeDialog
          programmeId={detail.programme.id}
          // The page's channel when the profile's list is read (its favourite flag), else the
          // search's.
          channel={
            channels?.items.find((channel) => channel.id === detail.programme.channel.id) ??
            detail.programme.channel
          }
          watch={detail.watch}
          onWatch={onClose}
          onClose={() => setDetail(undefined)}
        />
      )}
    </div>
  )
}
