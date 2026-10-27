import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { useEffect, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { genreLabel, sortGenresByLabel } from '@projo/i18n/genres'
import type { CatalogSort, WatchFilter } from '@projo/shared/api/catalog'
import { genreIdSchema } from '@projo/shared/api/genres'

import { currentLocale } from '../../shared/i18n/index.ts'
import { getActiveProfileId } from '../../shared/session/active-profile.ts'
import { sessionQuery } from '../../shared/session/session.ts'
import { Field, SelectChevron } from '../../shared/ui/controls.tsx'
import { FilterIcon } from '../../shared/ui/media-icons.tsx'
import { Sheet } from '../../shared/ui/Sheet.tsx'
import { EmptyState, ErrorState } from '../../shared/ui/states.tsx'
import { PosterTile } from '../media/PosterTile.tsx'
import { VirtualGrid } from '../media/VirtualGrid.tsx'
import {
  activeFilterCount,
  arrivalState,
  type CatalogSearch,
  clearFilters,
  decadesWithin,
  loadCatalogState,
  type CatalogStateDraft,
  normalizeCatalogState,
  saveCatalogState,
  yearsOf,
} from './catalog-state.ts'
import { type CatalogKind, type CatalogQueryState, catalogQuery, genresQuery } from './queries.ts'
import './catalog.css'

const sorts: readonly CatalogSort[] = ['added', 'title', 'year', 'rating']
const watchFilters: readonly WatchFilter[] = ['unwatched', 'in_progress', 'watched']

/** Genre, decade then year, watch state: the same controls inline (desktop) or in the sheet. */
const Filters = ({
  kind,
  state,
  onChange,
  idPrefix,
  compact,
}: {
  kind: CatalogKind
  state: CatalogQueryState
  onChange: (state: CatalogQueryState) => void
  idPrefix: string
  compact: boolean
}) => {
  const { t } = useTranslation()
  const genres = useQuery(genresQuery(kind))
  const genreOptions = sortGenresByLabel(t, genres.data?.genres ?? [], currentLocale())
  const set = (patch: Omit<CatalogStateDraft, 'sort'>) =>
    onChange(normalizeCatalogState({ ...state, ...patch }))
  return (
    <>
      <Field
        id={`${idPrefix}-genre`}
        label={t('catalog.filters.genre')}
        compact={compact}
        trail={<SelectChevron />}
      >
        <select
          id={`${idPrefix}-genre`}
          className="field__input"
          value={state.genre ?? ''}
          onChange={(event) => {
            const genre = genreIdSchema.safeParse(event.target.value)
            set({ genre: genre.success ? genre.data : undefined })
          }}
        >
          <option value="">{t('catalog.filters.allGenres')}</option>
          {state.genre !== undefined && !genreOptions.includes(state.genre) ? (
            <option value={state.genre}>{genreLabel(t, state.genre)}</option>
          ) : undefined}
          {genreOptions.map((genre) => (
            <option key={genre} value={genre}>
              {genreLabel(t, genre)}
            </option>
          ))}
        </select>
      </Field>
      <Field
        id={`${idPrefix}-decade`}
        label={t('catalog.filters.decade')}
        compact={compact}
        trail={<SelectChevron />}
      >
        <select
          id={`${idPrefix}-decade`}
          className="field__input"
          value={state.decade === undefined ? '' : String(state.decade)}
          onChange={(event) =>
            set({
              decade: event.target.value === '' ? undefined : Number(event.target.value),
              year: undefined,
            })
          }
        >
          <option value="">{t('catalog.filters.allYears')}</option>
          {decadesWithin(genres.data?.years, state.decade).map((decade) => (
            <option key={decade} value={decade}>
              {t('catalog.filters.decadeOf', { decade })}
            </option>
          ))}
        </select>
      </Field>
      <Field
        id={`${idPrefix}-year`}
        label={t('catalog.filters.year')}
        compact={compact}
        trail={<SelectChevron />}
      >
        <select
          id={`${idPrefix}-year`}
          className="field__input"
          value={state.year === undefined ? '' : String(state.year)}
          disabled={state.decade === undefined}
          onChange={(event) =>
            set({ year: event.target.value === '' ? undefined : Number(event.target.value) })
          }
        >
          <option value="">
            {state.decade === undefined
              ? t('catalog.filters.year')
              : t('catalog.filters.wholeDecade')}
          </option>
          {(state.decade === undefined ? [] : yearsOf(state.decade, genres.data?.years)).map(
            (year) => (
              <option key={year} value={year}>
                {year}
              </option>
            ),
          )}
        </select>
      </Field>
      <Field
        id={`${idPrefix}-watch`}
        label={t('catalog.filters.watch')}
        compact={compact}
        trail={<SelectChevron />}
      >
        <select
          id={`${idPrefix}-watch`}
          className="field__input"
          value={state.watch ?? ''}
          onChange={(event) =>
            set({ watch: (event.target.value || undefined) as WatchFilter | undefined })
          }
        >
          <option value="">{t('catalog.filters.allStates')}</option>
          {watchFilters.map((watch) => (
            <option key={watch} value={watch}>
              {t(`catalog.filters.watchState.${watch}`)}
            </option>
          ))}
        </select>
      </Field>
    </>
  )
}

/**
 * Movies and Shows (§13.4): poster grid (virtualized, cursor pages), sort, filters inline or in
 * the "Filtres" sheet on a phone, the whole state kept per profile and per device.
 */
export const CatalogPage = ({ kind, search }: { kind: CatalogKind; search: CatalogSearch }) => {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const sheetTitleId = useId()
  const profileId = getActiveProfileId() ?? 'none'
  const [state, setState] = useState<CatalogQueryState>(() =>
    arrivalState(loadCatalogState(profileId, kind), search),
  )
  const [filtersOpen, setFiltersOpen] = useState(false)
  const catalog = useInfiniteQuery(catalogQuery(kind, state))
  const session = useQuery(sessionQuery)
  const isAdmin = session.data?.status === 'signed_in' && session.data.me.account.role === 'admin'
  const filterCount = activeFilterCount(state)

  const change = (next: CatalogQueryState) => {
    setState(next)
    saveCatalogState(profileId, kind, next)
  }

  // "See all ›" arrives with `?sort=added`: the state it opened with (`arrivalState`) becomes the
  // remembered one, the URL is cleaned.
  const { sort } = search
  useEffect(() => {
    if (sort === undefined) return
    saveCatalogState(profileId, kind, arrivalState(loadCatalogState(profileId, kind), { sort }))
    void navigate({ to: kind === 'movies' ? '/movies' : '/series', search: {}, replace: true })
  }, [sort, profileId, kind, navigate])

  const items = catalog.data?.pages.flatMap((page) => page.items) ?? []
  const title = kind === 'movies' ? t('nav.movies') : t('nav.series')
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = catalog

  return (
    <div className="page catalog">
      <div className="catalog__header">
        <h1 className="page__title">{title}</h1>
        <div className="catalog__controls">
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
          <button
            type="button"
            className="button button--glass catalog__filters-button"
            aria-expanded={filtersOpen}
            onClick={() => setFiltersOpen(true)}
          >
            <FilterIcon />
            {filterCount === 0
              ? t('catalog.filters.title')
              : t('catalog.filters.titleCount', { count: filterCount })}
          </button>
        </div>
      </div>

      <div className="catalog__filters" role="group" aria-label={t('catalog.filters.title')}>
        <Filters kind={kind} state={state} onChange={change} idPrefix={`${kind}-filter`} compact />
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
          renderItem={(item) => <PosterTile item={item} />}
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
          <Filters
            kind={kind}
            state={state}
            onChange={change}
            idPrefix={`${kind}-sheet`}
            compact={false}
          />
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
    </div>
  )
}
