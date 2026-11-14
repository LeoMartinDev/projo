import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { genreLabel, sortGenresByLabel } from '@projo/i18n/genres'
import type { CatalogSort, WatchFilter } from '@projo/shared/api/catalog'
import type { GenreId } from '@projo/shared/api/genres'

import { currentLocale } from '../../shared/i18n/index.ts'
import { canAdminister, getActiveProfileId } from '../../shared/session/active-profile.ts'
import { sessionQuery } from '../../shared/session/session.ts'
import { SelectField } from '../../shared/ui/Select.tsx'
import { FilterIcon, SortIcon } from '../../shared/ui/media-icons.tsx'
import { Sheet } from '../../shared/ui/Sheet.tsx'
import { EmptyState, ErrorState } from '../../shared/ui/states.tsx'
import { useDevice } from '../../shared/ui/use-media.ts'
import { useGridCardSheet } from '../media/CardSheet.tsx'
import { PosterTile } from '../media/PosterTile.tsx'
import { VirtualGrid } from '../media/VirtualGrid.tsx'
import {
  activeFilterCount,
  clearFilters,
  decadesWithin,
  type CatalogStateDraft,
  normalizeCatalogState,
  saveCatalogState,
  useCatalogState,
  yearsOf,
} from './catalog-state.ts'
import { type CatalogKind, type CatalogQueryState, catalogQuery, genresQuery } from './queries.ts'
import './catalog.css'

const sorts: readonly CatalogSort[] = ['added', 'title', 'year', 'rating']
const watchFilters: readonly WatchFilter[] = ['unwatched', 'in_progress', 'watched']

const Filters = ({
  kind,
  state,
  onChange,
  idPrefix,
  compact,
  chips = false,
}: {
  kind: CatalogKind
  state: CatalogQueryState
  onChange: (state: CatalogQueryState) => void
  idPrefix: string
  compact: boolean
  chips?: boolean
}) => {
  const { t } = useTranslation()
  const genres = useQuery(genresQuery(kind))
  const genreOptions = sortGenresByLabel(t, genres.data?.genres ?? [], currentLocale())
  const genreChoices =
    state.genre !== undefined && !genreOptions.includes(state.genre)
      ? [state.genre, ...genreOptions]
      : genreOptions
  const set = (patch: Omit<CatalogStateDraft, 'sort'>) =>
    onChange(normalizeCatalogState({ ...state, ...patch }))
  const decades = decadesWithin(genres.data?.years, state.decade)
  const yearsValue =
    state.year !== undefined
      ? `y${state.year}`
      : state.decade !== undefined
        ? `d${state.decade}`
        : ''
  const yearsLabel =
    state.year !== undefined
      ? String(state.year)
      : state.decade !== undefined
        ? t('catalog.filters.decadeOf', { decade: state.decade })
        : t('catalog.filters.allYears')
  return (
    <>
      <SelectField<GenreId | ''>
        id={`${idPrefix}-genre`}
        label={t('catalog.filters.genre')}
        compact={compact}
        chip={chips}
        active={state.genre !== undefined}
        value={state.genre ?? ''}
        options={[
          { value: '', label: t('catalog.filters.allGenres') },
          ...genreChoices.map((genre) => ({ value: genre, label: genreLabel(t, genre) })),
        ]}
        onChange={(genre) => set({ genre: genre === '' ? undefined : genre })}
      />
      <SelectField<string>
        id={`${idPrefix}-years`}
        label={t('catalog.filters.decade')}
        compact={compact}
        chip={chips}
        active={yearsValue !== ''}
        value={yearsValue}
        display={yearsLabel}
        options={[
          { value: '', label: t('catalog.filters.allYears') },
          ...decades.map((decade) => ({
            group: t('catalog.filters.decadeOf', { decade }),
            options: [
              { value: `d${decade}`, label: t('catalog.filters.wholeDecade') },
              ...yearsOf(decade, genres.data?.years).map((year) => ({
                value: `y${year}`,
                label: String(year),
              })),
            ],
          })),
        ]}
        onChange={(value) => {
          const number = Number(value.slice(1))
          set(
            value.startsWith('y')
              ? { decade: Math.floor(number / 10) * 10, year: number }
              : { decade: value === '' ? undefined : number, year: undefined },
          )
        }}
      />
      <SelectField<WatchFilter | ''>
        id={`${idPrefix}-watch`}
        label={t('catalog.filters.watch')}
        compact={compact}
        chip={chips}
        active={state.watch !== undefined}
        value={state.watch ?? ''}
        options={[
          { value: '', label: t('catalog.filters.allStates') },
          ...watchFilters.map((watch) => ({
            value: watch,
            label: t(`catalog.filters.watchState.${watch}`),
          })),
        ]}
        onChange={(watch) => set({ watch: watch === '' ? undefined : watch })}
      />
    </>
  )
}

const SortChip = ({
  id,
  value,
  onChange,
}: {
  id: string
  value: CatalogSort
  onChange: (sort: CatalogSort) => void
}) => {
  const { t } = useTranslation()
  return (
    <SelectField
      id={id}
      label={t('catalog.sortBy')}
      chip
      icon={<SortIcon size={16} />}
      value={value}
      options={sorts.map((sort) => ({ value: sort, label: t(`catalog.sort.${sort}`) }))}
      onChange={onChange}
    />
  )
}

export const CatalogSkeleton = ({ kind }: { kind: CatalogKind | 'watchlist' }) => {
  const { t } = useTranslation()
  const title =
    kind === 'movies' ? t('nav.movies') : kind === 'series' ? t('nav.series') : t('nav.watchlist')
  return (
    <div className="page catalog">
      <div className="catalog__header">
        <h1 className="page__title">{title}</h1>
      </div>
      <VirtualGrid
        items={[]}
        label={title}
        pending
        fetchingMore={false}
        hasMore={false}
        onMore={() => undefined}
        renderItem={() => undefined}
      />
    </div>
  )
}

export const CatalogPage = ({ kind }: { kind: CatalogKind }) => {
  const { t } = useTranslation()
  const sheetTitleId = useId()
  const profileId = getActiveProfileId() ?? 'none'
  const state = useCatalogState(profileId, kind)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [sheetUsed, setSheetUsed] = useState(false)
  const catalog = useInfiniteQuery(catalogQuery(kind, state))
  const session = useQuery(sessionQuery)
  const isAdmin = session.data?.status === 'signed_in' && canAdminister(session.data.me)
  const filterCount = activeFilterCount(state)
  const device = useDevice()

  const change = (next: CatalogQueryState) => saveCatalogState(profileId, kind, next)
  const openFilters = () => {
    setSheetUsed(true)
    setFiltersOpen(true)
  }

  const items = catalog.data?.pages.flatMap((page) => page.items) ?? []
  const cardSheet = useGridCardSheet(items)
  const title = kind === 'movies' ? t('nav.movies') : t('nav.series')
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = catalog

  return (
    <div className="page catalog">
      <div className="catalog__header">
        <h1 className="page__title">{title}</h1>
        <div className="catalog__controls">
          {device === 'tablet' ? (
            <SortChip
              id={`${kind}-sort`}
              value={state.sort}
              onChange={(value) => change({ ...state, sort: value })}
            />
          ) : (
            <div
              className="seg seg--4"
              role="group"
              aria-label={t('catalog.sortBy')}
              data-active={sorts.indexOf(state.sort)}
            >
              <span className="seg__indicator" aria-hidden="true" />
              {sorts.map((value) => (
                <button
                  key={value}
                  type="button"
                  className="seg__option"
                  aria-pressed={state.sort === value}
                  onClick={() => change({ ...state, sort: value })}
                >
                  {t(`catalog.sort.${value}`)}
                </button>
              ))}
            </div>
          )}
          <button
            type="button"
            className="button button--glass catalog__filters-button"
            aria-expanded={filtersOpen}
            onClick={openFilters}
          >
            <FilterIcon />
            {filterCount === 0
              ? t('catalog.filters.title')
              : t('catalog.filters.titleCount', { count: filterCount })}
          </button>
        </div>
      </div>

      {device === 'phone' ? undefined : (
        <div className="catalog__filters" role="group" aria-label={t('catalog.filters.title')}>
          <Filters
            kind={kind}
            state={state}
            onChange={change}
            idPrefix={`${kind}-filter`}
            compact
            chips={device === 'tablet'}
          />
          {filterCount === 0 ? undefined : (
            <button
              type="button"
              className="button button--small"
              onClick={() => change(clearFilters(state))}
            >
              {t('catalog.filters.clear')}
            </button>
          )}
        </div>
      )}

      {catalog.isError && items.length === 0 ? (
        <ErrorState error={catalog.error} onRetry={() => void catalog.refetch()} />
      ) : catalog.isSuccess && items.length === 0 ? (
        filterCount > 0 ? (
          <EmptyState
            title={t('catalog.noMatch')}
            action={
              <button
                type="button"
                className="button button--glass"
                onClick={() => change(clearFilters(state))}
              >
                {t('catalog.filters.clear')}
              </button>
            }
          />
        ) : (
          <EmptyState
            title={kind === 'movies' ? t('catalog.emptyMovies') : t('catalog.emptySeries')}
            text={isAdmin ? t('catalog.emptyAdmin') : t('catalog.emptyUser')}
            action={
              isAdmin ? (
                <Link to="/admin/libraries" className="button button--primary">
                  {t('catalog.manageLibraries')}
                </Link>
              ) : undefined
            }
          />
        )
      ) : (
        <VirtualGrid
          items={items}
          label={title}
          pending={catalog.isPending}
          fetchingMore={isFetchingNextPage}
          hasMore={hasNextPage && !catalog.isFetchNextPageError}
          onMore={() => void fetchNextPage()}
          renderItem={(item, sizes) => (
            <PosterTile item={item} sizes={sizes} onLongPress={cardSheet.onLongPress} />
          )}
        />
      )}
      {catalog.isFetchNextPageError ? (
        <ErrorState error={catalog.error} onRetry={() => void fetchNextPage()} />
      ) : undefined}

      <Sheet open={filtersOpen} labelledBy={sheetTitleId} onClose={() => setFiltersOpen(false)}>
        <h2 id={sheetTitleId} className="sheet__title">
          {t('catalog.filters.title')}
        </h2>
        <div className="catalog__sheet-fields">
          {sheetUsed ? (
            <Filters
              kind={kind}
              state={state}
              onChange={change}
              idPrefix={`${kind}-sheet`}
              compact={false}
            />
          ) : undefined}
        </div>
        <div className="catalog__sheet-actions">
          <button
            type="button"
            className="button button--glass"
            disabled={filterCount === 0}
            onClick={() => change(clearFilters(state))}
          >
            {t('catalog.filters.clear')}
          </button>
          <button
            type="button"
            className="button button--primary"
            onClick={() => setFiltersOpen(false)}
          >
            {t('catalog.filters.show')}
          </button>
        </div>
      </Sheet>
      {cardSheet.sheet}
    </div>
  )
}
