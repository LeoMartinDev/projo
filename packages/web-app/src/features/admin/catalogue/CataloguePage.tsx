import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { CatalogItemDto, CatalogItemKind, CatalogItemsSort } from '@projo/shared/api/metadata'

import { formatDateTime, formatNumber, formatRelative } from '../../../shared/format/format.ts'
import { currentLocale } from '../../../shared/i18n/index.ts'
import { Field } from '../../../shared/ui/controls.tsx'
import { LayersIcon } from '../../../shared/ui/icons.tsx'
import { Segmented } from '../../../shared/ui/Segmented.tsx'
import { SelectField } from '../../../shared/ui/Select.tsx'
import { EmptyState, ErrorState } from '../../../shared/ui/states.tsx'
import { useDebounced } from '../../../shared/ui/use-debounced.ts'
import { useElement } from '../../../shared/ui/use-element.ts'
import { useNow } from '../../../shared/ui/use-now.ts'
import { AdminMenu } from '../../item/TitleMenu.tsx'
import { SearchIcon } from '../admin-icons.tsx'
import { MediaSection } from '../admin-sections.tsx'
import { EditItemDialog } from '../metadata/EditItemDialog.tsx'
import { Pager } from '../PagedTable.tsx'
import { librariesQuery } from '../queries.ts'
import { SkeletonRows } from '../SkeletonRows.tsx'
import { useCursorPages } from '../use-cursor-pages.ts'
import { type CatalogueSearch, catalogueQuery } from './catalogue-search.ts'
import { EditedMark, FilesCount, PosterThumb } from './parts.tsx'
import { catalogueItemsQuery } from './queries.ts'
import '../admin.css'
import '../accounts/accounts.css'
import '../admin-table.css'
import './catalogue.css'

type KindFilter = CatalogItemKind | 'all'
const kindFilters: readonly KindFilter[] = ['all', 'movie', 'series']
const sorts: readonly CatalogItemsSort[] = ['title', 'added', 'year']

type Editing = { id: string; name: string }

const withText = (search: CatalogueSearch, text: string): CatalogueSearch => {
  const { q: _q, ...rest } = search
  return text === '' ? rest : { ...rest, q: text }
}

/**
 * The search field's text, written to the address once typing pauses. The address changing it
 * otherwise (the tab's link, which clears the filters) puts its value back in the field.
 */
const useSearchText = (search: CatalogueSearch, onSearch: (next: CatalogueSearch) => void) => {
  const [text, setText] = useState(search.q ?? '')
  const debounced = useDebounced(text, 300)
  const typed = debounced.trim() === '' ? '' : debounced
  const address = search.q ?? ''
  const latest = useRef({ search, onSearch })
  useEffect(() => {
    latest.current = { search, onSearch }
  })
  useEffect(() => {
    const { search: current, onSearch: send } = latest.current
    if ((current.q ?? '') !== typed) send(withText(current, typed))
  }, [typed])
  const sent = useRef(typed)
  useEffect(() => {
    if (address !== sent.current && address !== typed) setText(address)
    sent.current = typed
  }, [address, typed])
  return [text, setText] as const
}

const Content = ({ item }: { item: CatalogItemDto }) => {
  const { t } = useTranslation()
  const locale = currentLocale()
  if (item.kind === 'movie') return <FilesCount files={item.files} />
  const episodes = item.episodes ?? 0
  const shown = [
    t('item.seasonCount', { count: item.seasons ?? 0 }),
    item.episodesTmdb === undefined || item.episodesTmdb < episodes
      ? t('admin.catalogue.episodes', {
          count: episodes,
          formatted: formatNumber(episodes, locale),
        })
      : t('item.episodesOf', { available: episodes, total: item.episodesTmdb }),
  ].join(' · ')
  return (
    <>
      <span className="adm-line">{shown}</span>
      {item.files.ready === 0 || item.files.missing > 0 ? (
        <FilesCount files={item.files} />
      ) : undefined}
    </>
  )
}

const CatalogueRow = ({ item, onEdit }: { item: CatalogItemDto; onEdit: () => void }) => {
  const { t } = useTranslation()
  const locale = currentLocale()
  const now = useNow()
  const libraries = item.libraries.map((library) => library.name).join(', ')
  const detail = [item.year, t(`admin.catalogue.kind.${item.kind}`)]
    .filter((part) => part !== undefined)
    .join(' · ')
  return (
    <div className="adm-tr cat-tr" role="row">
      <div className="adm-cell cat-title" role="cell">
        <PosterThumb src={item.poster} kind={item.kind} />
        <div className="cat-title__text">
          <span className="cat-title__line">
            {item.kind === 'series' ? (
              <Link to="/admin/catalogue/$itemId" params={{ itemId: item.id }} className="adm-open">
                {item.title}
              </Link>
            ) : (
              <button type="button" className="adm-open" aria-haspopup="dialog" onClick={onEdit}>
                {item.title}
              </button>
            )}
            <EditedMark locked={item.locked} />
          </span>
          <span className="adm-muted">{detail}</span>
        </div>
      </div>
      <div className="adm-cell adm-optional" role="cell">
        <span className="adm-muted" title={libraries}>
          {libraries}
        </span>
      </div>
      <div className="adm-cell cat-content" role="cell">
        <Content item={item} />
      </div>
      <div className="adm-cell adm-optional" role="cell">
        <span className="adm-muted" title={formatDateTime(item.addedAt, locale)}>
          {formatRelative(item.addedAt, locale, now)}
        </span>
      </div>
      <div className="adm-actions" role="cell">
        <AdminMenu
          align="end"
          itemId={item.id}
          kind={item.kind}
          name={item.title}
          onMoved={() => undefined}
        />
      </div>
    </div>
  )
}

/** Media › Catalogue (§15): the movies and shows, to find a title and correct its metadata. */
export const CataloguePage = ({
  search,
  onSearch,
}: {
  search: CatalogueSearch
  onSearch: (next: CatalogueSearch) => void
}) => {
  const { t } = useTranslation()
  const searchId = useId()
  const libraryId = useId()
  const sortId = useId()
  const [text, setText] = useSearchText(search, onSearch)
  const [editing, setEditing] = useState<Editing | undefined>()
  const pages = useCursorPages(JSON.stringify(catalogueQuery(search)), { remember: true })
  const list = useQuery(catalogueItemsQuery(search, pages.cursor))
  const libraries = useQuery(librariesQuery)
  const [table, tableRef] = useElement<HTMLDivElement>()
  const shownView = useRef(pages.view)
  const items = list.data?.items ?? []
  const nextCursor = list.isPlaceholderData ? undefined : list.data?.nextCursor
  const filtered = Object.keys(catalogueQuery(search)).some((key) => key !== 'sort')

  // A new page (or new filters) shows from its first row; never on arrival, which keeps the
  // scroll the router restored.
  useEffect(() => {
    if (list.isPlaceholderData || table === undefined || shownView.current === pages.view) return
    shownView.current = pages.view
    if (table.getBoundingClientRect().top < 0) table.scrollIntoView({ block: 'start' })
  }, [table, pages.view, list.isPlaceholderData])

  const libraryOptions = libraries.data?.items ?? []

  return (
    <MediaSection>
      <div className="adm-toolbar">
        <Field
          id={searchId}
          label={t('admin.catalogue.search')}
          compact
          icon={<SearchIcon size={16} />}
        >
          <input
            id={searchId}
            className="field__input"
            type="search"
            spellCheck={false}
            maxLength={200}
            autoComplete="off"
            placeholder={t('admin.catalogue.search')}
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
        </Field>
        <Segmented<KindFilter>
          role="toggle"
          label={t('admin.catalogue.kindLabel')}
          options={kindFilters.map((value) => ({
            value,
            label: t(`admin.catalogue.kinds.${value}`),
          }))}
          value={search.kind ?? 'all'}
          onChange={(kind) => {
            const { kind: _kind, ...rest } = search
            onSearch(kind === 'all' ? rest : { ...rest, kind })
          }}
        />
        {libraryOptions.length > 1 ? (
          <SelectField
            compact
            icon={<LayersIcon size={16} />}
            id={libraryId}
            label={t('admin.catalogue.library')}
            value={search.library ?? ''}
            options={[
              { value: '', label: t('admin.catalogue.allLibraries') },
              ...libraryOptions.map((library) => ({ value: library.id, label: library.name })),
            ]}
            onChange={(library) => {
              const { library: _library, ...rest } = search
              onSearch(library === '' ? rest : { ...rest, library })
            }}
          />
        ) : undefined}
        <SelectField<CatalogItemsSort>
          compact
          id={sortId}
          label={t('admin.catalogue.sort')}
          value={search.sort ?? 'title'}
          options={sorts.map((value) => ({ value, label: t(`admin.catalogue.sorts.${value}`) }))}
          onChange={(sort) => {
            const { sort: _sort, ...rest } = search
            onSearch(sort === 'title' ? rest : { ...rest, sort })
          }}
        />
      </div>

      <div
        ref={tableRef}
        className="adm-table cat-table"
        role="table"
        aria-label={t('admin.catalogue.title')}
        aria-busy={list.isPlaceholderData}
      >
        <div className="adm-tr cat-tr adm-tr--head" role="row">
          <span role="columnheader">{t('admin.catalogue.columns.title')}</span>
          <span role="columnheader" className="adm-optional">
            {t('admin.catalogue.columns.libraries')}
          </span>
          <span role="columnheader">{t('admin.catalogue.columns.content')}</span>
          <span role="columnheader" className="adm-optional">
            {t('admin.catalogue.columns.added')}
          </span>
          <span role="columnheader" />
        </div>
        <div className="adm-table__body">
          {list.isPending ? <SkeletonRows count={8} /> : undefined}
          {list.isError && items.length === 0 ? (
            <ErrorState error={list.error} onRetry={() => void list.refetch()} />
          ) : undefined}
          {list.isSuccess && items.length === 0 ? (
            <EmptyState
              compact
              title={filtered ? t('admin.catalogue.noMatch') : t('admin.catalogue.empty')}
            />
          ) : undefined}
          {items.map((item) => (
            <CatalogueRow
              key={item.id}
              item={item}
              onEdit={() => setEditing({ id: item.id, name: item.title })}
            />
          ))}
        </div>
      </div>
      {pages.page > 1 || nextCursor !== undefined ? (
        <Pager pages={pages} nextCursor={nextCursor} changing={list.isPlaceholderData} />
      ) : undefined}

      {editing === undefined ? undefined : (
        <EditItemDialog
          key={editing.id}
          itemId={editing.id}
          name={editing.name}
          open
          onClose={() => setEditing(undefined)}
        />
      )}
    </MediaSection>
  )
}
