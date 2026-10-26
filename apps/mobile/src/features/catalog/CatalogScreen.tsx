import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { Stack, useLocalSearchParams, useRouter } from 'expo-router'
import { SymbolView } from 'expo-symbols'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native'

import { genreLabel, sortGenresByLabel } from '@projo/i18n/genres'
import { canAdminister } from '@projo/shared/api/auth'
import type { CatalogSort, WatchFilter } from '@projo/shared/api/catalog'
import {
  activeFilterCount,
  arrivalState,
  type CatalogQueryState,
  type CatalogStateDraft,
  clearFilters,
  decadesWithin,
  normalizeCatalogState,
  parseCatalogSearch,
  yearsOf,
} from '@projo/shared/api/catalog-state'
import type { GenreId } from '@projo/shared/api/genres'

import { colors } from '../../shared/styles/tokens.ts'
import { Button } from '../../shared/ui/Button.tsx'
import { Chips, Segmented } from '../../shared/ui/Choices.tsx'
import { Sheet } from '../../shared/ui/Sheet.tsx'
import { EmptyState, ErrorState } from '../../shared/ui/states.tsx'
import { textStyles } from '../../shared/ui/text.ts'
import { useLocale } from '../media/card-text.ts'
import { PosterGrid } from '../media/PosterGrid.tsx'
import { useServerConnection } from '../server-connection/ServerConnection.tsx'
import { useSession } from '../session/Session.tsx'
import { useCatalogState } from './catalog-store.ts'
import { type CatalogKind, useCatalogQueries } from './queries.ts'

const sorts: readonly CatalogSort[] = ['added', 'title', 'year', 'rating']
const watchFilters: readonly WatchFilter[] = ['unwatched', 'in_progress', 'watched']

/** The "Filters" sheet of a phone (§13.4): genre, years then year, watched or not. */
const FiltersSheet = ({
  kind,
  open,
  state,
  onChange,
  onClose,
}: {
  kind: CatalogKind
  open: boolean
  state: CatalogQueryState
  onChange: (state: CatalogQueryState) => void
  onClose: () => void
}) => {
  const { t } = useTranslation()
  const locale = useLocale()
  const genres = useQuery(useCatalogQueries().genres(kind))
  const years = genres.data?.years
  const set = (patch: Omit<CatalogStateDraft, 'sort'>) =>
    onChange(normalizeCatalogState({ ...state, ...patch }))
  const genreIds = sortGenresByLabel(t, genres.data?.genres ?? [], locale)
  const shownGenres =
    state.genre === undefined || genreIds.includes(state.genre)
      ? genreIds
      : [state.genre, ...genreIds]
  const all = (label: string) => ({ value: undefined, label })

  return (
    <Sheet onClose={onClose} open={open} title={t('catalog.filters.title')}>
      <Text style={textStyles.section}>{t('catalog.filters.genre')}</Text>
      <Chips<GenreId | undefined>
        choices={[
          all(t('catalog.filters.allGenres')),
          ...shownGenres.map((genre) => ({ value: genre, label: genreLabel(t, genre) })),
        ]}
        label={t('catalog.filters.genre')}
        onChange={(genre) => set({ genre })}
        value={state.genre}
      />
      <Text style={textStyles.section}>{t('catalog.filters.decade')}</Text>
      <Chips<number | undefined>
        choices={[
          all(t('catalog.filters.allYears')),
          ...decadesWithin(years, state.decade).map((decade) => ({
            value: decade,
            label: t('catalog.filters.decadeOf', { decade }),
          })),
        ]}
        label={t('catalog.filters.decade')}
        onChange={(decade) => set({ decade, year: undefined })}
        value={state.decade}
      />
      {state.decade === undefined ? undefined : (
        <>
          <Text style={textStyles.section}>{t('catalog.filters.year')}</Text>
          <Chips<number | undefined>
            choices={[
              all(t('catalog.filters.wholeDecade')),
              ...yearsOf(state.decade, years).map((year) => ({ value: year, label: String(year) })),
            ]}
            label={t('catalog.filters.year')}
            onChange={(year) => set({ year })}
            value={state.year}
          />
        </>
      )}
      <Text style={textStyles.section}>{t('catalog.filters.watch')}</Text>
      <Chips<WatchFilter | undefined>
        choices={[
          all(t('catalog.filters.allStates')),
          ...watchFilters.map((watch) => ({
            value: watch,
            label: t(`catalog.filters.watchState.${watch}`),
          })),
        ]}
        label={t('catalog.filters.watch')}
        onChange={(watch) => set({ watch })}
        value={state.watch}
      />
      <View style={styles.sheetActions}>
        <View style={styles.grow}>
          <Button
            disabled={activeFilterCount(state) === 0}
            label={t('catalog.filters.clear')}
            onPress={() => onChange(clearFilters(state))}
            variant="secondary"
          />
        </View>
        <View style={styles.grow}>
          <Button label={t('catalog.filters.show')} onPress={onClose} />
        </View>
      </View>
    </Sheet>
  )
}

/**
 * Movies and Shows (§13.4): the poster grid, the sort above it, the filters in a sheet behind the
 * header's button; the whole state kept per profile and per device. "See all ›" of Recently added
 * arrives with `?sort=added`, which becomes the remembered sort.
 */
export const CatalogScreen = ({ kind }: { kind: CatalogKind }) => {
  const { t } = useTranslation()
  const router = useRouter()
  const queries = useCatalogQueries()
  const { state, change } = useCatalogState(kind)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const params = useLocalSearchParams()
  const arrival = parseCatalogSearch(params)
  const shown = state === undefined ? undefined : arrivalState(state, arrival)
  const catalog = useInfiniteQuery({
    ...queries.catalog(kind, shown ?? { sort: 'title' }),
    enabled: shown !== undefined,
  })
  const { gate } = useSession()
  const { gate: connection } = useServerConnection()

  // The link's sort becomes the remembered one, and leaves the route.
  const arrivalSort = arrival.sort
  useEffect(() => {
    if (arrivalSort === undefined || state === undefined) return
    if (state.sort !== arrivalSort) change({ ...state, sort: arrivalSort })
    router.setParams({ sort: undefined })
  }, [arrivalSort, state, change, router])

  const filterCount = shown === undefined ? 0 : activeFilterCount(shown)
  const items = catalog.data?.pages.flatMap((page) => page.items) ?? []
  const admin = gate.kind === 'ready' && canAdminister(gate.me)
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = catalog

  const empty =
    shown === undefined || !catalog.isSuccess ? undefined : filterCount > 0 ? (
      <EmptyState
        action={
          <Button
            label={t('catalog.filters.clear')}
            onPress={() => change(clearFilters(shown))}
            size="small"
            variant="secondary"
          />
        }
        title={t('catalog.noMatch')}
      />
    ) : (
      <EmptyState
        action={
          admin && connection.kind === 'connected' ? (
            <Button
              label={t('catalog.manageLibraries')}
              onPress={() => void Linking.openURL(`${connection.url}/admin/libraries`)}
            />
          ) : undefined
        }
        text={admin ? t('catalog.emptyAdmin') : t('catalog.emptyUser')}
        title={kind === 'movies' ? t('catalog.emptyMovies') : t('catalog.emptySeries')}
      />
    )

  return (
    <>
      <Stack.Screen
        options={{
          headerRight: () => (
            <Pressable
              accessibilityLabel={
                filterCount === 0
                  ? t('catalog.filters.title')
                  : t('catalog.filters.titleCount', { count: filterCount })
              }
              accessibilityRole="button"
              hitSlop={8}
              onPress={() => setFiltersOpen(true)}
              style={styles.filtersButton}
            >
              <SymbolView
                name={
                  filterCount === 0
                    ? 'line.3.horizontal.decrease'
                    : 'line.3.horizontal.decrease.circle.fill'
                }
                size={20}
                tintColor={colors.text}
              />
            </Pressable>
          ),
        }}
      />
      {catalog.isError && items.length === 0 ? (
        <View style={styles.error}>
          <ErrorState error={catalog.error} onRetry={() => void catalog.refetch()} />
        </View>
      ) : (
        <PosterGrid
          empty={empty}
          fetchingMore={isFetchingNextPage}
          hasMore={hasNextPage}
          header={
            <Segmented
              choices={sorts.map((sort) => ({ value: sort, label: t(`catalog.sort.${sort}`) }))}
              label={t('catalog.sortBy')}
              onChange={(sort) => shown !== undefined && change({ ...shown, sort })}
              value={shown?.sort}
            />
          }
          items={items}
          onMore={() => void fetchNextPage()}
          pending={shown === undefined || catalog.isPending}
          queryKey={queries.catalog(kind, shown ?? { sort: 'title' }).queryKey}
        />
      )}
      {shown === undefined ? undefined : (
        <FiltersSheet
          kind={kind}
          onChange={change}
          onClose={() => setFiltersOpen(false)}
          open={filtersOpen}
          state={shown}
        />
      )}
    </>
  )
}

const styles = StyleSheet.create({
  filtersButton: { paddingHorizontal: 6, height: 36, justifyContent: 'center' },
  error: { flex: 1, justifyContent: 'center', backgroundColor: colors.bg },
  sheetActions: { flexDirection: 'row', gap: 10, paddingTop: 12 },
  grow: { flex: 1 },
})
