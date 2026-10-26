import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'
import {
  Linking,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native'

import { categoryTitle } from '@projo/i18n/genres'
import { canAdminister } from '@projo/shared/api/auth'
import type { ItemSummaryDto } from '@projo/shared/api/catalog'
import {
  type HomeRowDto,
  homeCategoryKey,
  homeCategorySlug,
  recentlyAddedTarget,
  reservedCategoryRows,
  type ResumeFrameDto,
} from '@projo/shared/api/home'

import { colors } from '../../shared/styles/tokens.ts'
import { useScreenLayout } from '../../shared/styles/use-layout.ts'
import { Button } from '../../shared/ui/Button.tsx'
import { Logo } from '../../shared/ui/EntryScreen.tsx'
import { EmptyState, ErrorState, Skeleton } from '../../shared/ui/states.tsx'
import { useCatalogQueries } from '../catalog/queries.ts'
import type { CardPlace } from '../media/card-text.ts'
import { MediaCard } from '../media/MediaCard.tsx'
import { useOpenCardSheet, useOpenItem } from '../media/navigation.ts'
import { Avatar } from '../profiles/Avatar.tsx'
import { useServerConnection } from '../server-connection/ServerConnection.tsx'
import { useSession } from '../session/Session.tsx'
import { Hero, heroHeight } from './Hero.tsx'
import { Row, RowSkeleton } from './Row.tsx'

const rowTitleKey = {
  continue_watching: 'home.rows.continueWatching',
  up_next: 'home.rows.upNext',
  recently_added: 'home.rows.recentlyAdded',
  watchlist: 'home.rows.watchlist',
} as const

/** The next category batch is asked for this far before the end of the page. */
const aheadPx = 800

type Card = { item: ItemSummaryDto; isNew: boolean; resumeFrame?: ResumeFrameDto }

const cardsOf = (row: HomeRowDto): Card[] =>
  row.kind === 'up_next'
    ? row.items.map((entry) => ({ item: entry.episode, isNew: entry.isNew }))
    : row.kind === 'continue_watching'
      ? row.items.map((item) => ({
          item,
          isNew: false,
          ...(item.resumeFrame === undefined ? {} : { resumeFrame: item.resumeFrame }),
        }))
      : row.items.map((item) => ({ item, isNew: false }))

/**
 * Home (§13.3, artboards `MobileHome` on an iPhone, `Home` on an iPad): the avatar at the top
 * (settings, §26.5), the hero, the fixed rows, then the category rows, batch by batch as the page
 * nears its end.
 */
export const HomeScreen = () => {
  const { t } = useTranslation()
  const router = useRouter()
  const window = useWindowDimensions()
  const layout = useScreenLayout()
  const { gutter, gap, regular } = layout
  const queries = useCatalogQueries()
  const home = useQuery(queries.home)
  const categories = useInfiniteQuery(queries.homeCategories)
  const openItem = useOpenItem()
  const openHomeSheet = useOpenCardSheet(queries.home.queryKey)
  const openCategorySheet = useOpenCardSheet(queries.homeCategories.queryKey)
  const { gate } = useSession()
  const { gate: connection } = useServerConnection()
  if (gate.kind !== 'ready') return undefined
  const { profile, me } = gate

  const { hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage } = categories
  const onScroll = ({ nativeEvent }: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, layoutMeasurement, contentSize } = nativeEvent
    const near = contentOffset.y + layoutMeasurement.height > contentSize.height - aheadPx
    if (near && hasNextPage && !isFetchingNextPage && !isFetchNextPageError) void fetchNextPage()
  }

  const cardWidth = (place: CardPlace) =>
    place === 'recently_added' || place === 'category' ? layout.posterCard : layout.wideCard
  const card = (
    { item, isNew, resumeFrame }: Card,
    place: CardPlace,
    openSheet: (item: ItemSummaryDto, place: CardPlace) => void,
  ) => (
    <MediaCard
      key={item.id}
      isNew={isNew}
      item={item}
      onLongPress={() => openSheet(item, place)}
      onPress={() => openItem(item)}
      place={place}
      resumeFrame={resumeFrame}
      width={cardWidth(place)}
    />
  )
  const seeAllOf = (row: HomeRowDto) =>
    row.kind === 'watchlist'
      ? () => router.navigate('/list')
      : row.kind === 'recently_added'
        ? () =>
            router.navigate({
              pathname: recentlyAddedTarget(row.items) === 'series' ? '/shows' : '/movies',
              params: { sort: 'added' },
            })
        : undefined

  const header = (
    <View style={[styles.header, { paddingHorizontal: gutter }]}>
      <Logo />
      <Pressable
        accessibilityLabel={t('shell.accountMenu', { name: profile.name })}
        accessibilityRole="button"
        hitSlop={6}
        onPress={() => router.push('/settings')}
        style={({ pressed }) => pressed && styles.pressed}
      >
        <Avatar color={profile.avatarColor} name={profile.name} size={34} />
      </Pressable>
    </View>
  )

  const body = () => {
    if (home.isError) return <ErrorState error={home.error} onRetry={() => void home.refetch()} />
    if (home.isPending)
      return (
        <View aria-busy style={styles.rows}>
          <Skeleton
            height={heroHeight(regular, layout.width, window.height)}
            radius={regular ? 0 : 22}
            style={regular ? {} : { marginHorizontal: 16 }}
          />
          <RowSkeleton gap={gap} gutter={gutter} poster={false} width={layout.wideCard} />
          <RowSkeleton gap={gap} gutter={gutter} poster width={layout.posterCard} />
        </View>
      )
    const { hero, rows } = home.data
    if (hero === undefined && rows.length === 0) {
      const admin = canAdminister(me)
      return (
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
          title={t('home.empty')}
        />
      )
    }
    const pages = categories.data?.pages ?? []
    const reserved = reservedCategoryRows(pages)
    return (
      <>
        {hero === undefined ? undefined : <Hero key={hero.item.id} hero={hero} regular={regular} />}
        <View style={styles.rows}>
          {rows.map((row) => (
            <Row
              key={row.kind}
              gap={gap}
              gutter={gutter}
              onSeeAll={seeAllOf(row)}
              title={t(rowTitleKey[row.kind])}
            >
              {cardsOf(row).map((entry) => card(entry, row.kind, openHomeSheet))}
            </Row>
          ))}
          {pages
            .flatMap((page) => page.rows)
            .map(({ category, items }) => (
              <Row
                key={homeCategoryKey(category)}
                gap={gap}
                gutter={gutter}
                onSeeAll={() =>
                  router.push({
                    pathname: '/categories/[category]',
                    params: { category: homeCategorySlug(category) },
                  })
                }
                title={categoryTitle(t, category)}
              >
                {items.map((item) => card({ item, isNew: false }, 'category', openCategorySheet))}
              </Row>
            ))}
          {categories.isError ? (
            <ErrorState
              error={categories.error}
              onRetry={() => void (pages.length === 0 ? categories.refetch() : fetchNextPage())}
            />
          ) : (
            Array.from({ length: reserved }, (_, index) => (
              <RowSkeleton key={index} gap={gap} gutter={gutter} poster width={layout.posterCard} />
            ))
          )}
        </View>
      </>
    )
  }

  return (
    <View onLayout={layout.onLayout} style={styles.root}>
      <ScrollView
        contentContainerStyle={styles.content}
        contentInsetAdjustmentBehavior="automatic"
        onScroll={onScroll}
        scrollEventThrottle={200}
      >
        {header}
        {body()}
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 12,
    paddingBottom: 12,
  },
  pressed: { opacity: 0.6 },
  content: { paddingBottom: 32 },
  rows: { gap: 28, paddingTop: 28 },
})
