import { useQuery } from '@tanstack/react-query'
import { Redirect } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { episodeLine } from '@projo/i18n/item-titles'
import { formatClock, formatDuration } from '@projo/i18n/format'
import { durationMsOf, formatRemaining } from '@projo/i18n/media'
import type { ItemDetailDto } from '@projo/shared/api/catalog'

import { colors } from '../../shared/styles/tokens.ts'
import { useScreenLayout } from '../../shared/styles/use-layout.ts'
import { ErrorState, Skeleton } from '../../shared/ui/states.tsx'
import { useWatchedToggle, useWatchlistToggle } from '../catalog/actions.ts'
import { useCatalogQueries } from '../catalog/queries.ts'
import { PlayButton } from '../media/buttons.tsx'
import { useLocale } from '../media/card-text.ts'
import { DetailHead, HeadAction, ProgressLine } from './DetailHead.tsx'
import { CastRow, Tracks } from './sections.tsx'
import { SeriesEpisodes } from './SeriesEpisodes.tsx'

/**
 * A movie or an episode (§13.5): "Play" or "Resume at 1:12", My list (movies), Mark as watched,
 * then the available tracks and the cast. "From the beginning" plays: it comes with playback (M6
 * slice 5).
 */
const PlayableDetail = ({ item, regular, gutter }: { item: ItemDetailDto } & Layout) => {
  const { t } = useTranslation()
  const locale = useLocale()
  const watchlist = useWatchlistToggle()
  const watched = useWatchedToggle()
  const durationMs = durationMsOf(item)
  const progress = item.progress
  const resume = progress?.state === 'in_progress' ? progress.resumePositionMs : undefined
  const seen = watched.watched(item)
  const listed = watchlist.listed(item)
  return (
    <>
      <DetailHead
        actions={
          <>
            {item.kind === 'movie' ? (
              <HeadAction
                icon={listed ? 'checkmark' : 'plus'}
                label={t('card.myList')}
                onPress={() => watchlist.toggle(item, !listed)}
                regular={regular}
                selected={listed}
              />
            ) : undefined}
            <HeadAction
              icon={seen ? 'eye.slash' : 'eye'}
              label={seen ? t('item.markUnwatched') : t('item.markWatched')}
              onPress={() => watched.set(item.id, !seen)}
              regular={regular}
              selected={seen}
            />
          </>
        }
        backdrop={item.images.still ?? item.images.backdrop ?? item.series?.images?.backdrop}
        eyebrow={
          item.kind === 'episode' && item.series?.title !== undefined
            ? `${item.series.title} · ${episodeLine(t, { ...item, title: undefined })}`
            : undefined
        }
        extra={durationMs === undefined ? undefined : formatDuration(durationMs, locale)}
        item={item}
        play={
          item.sources.length === 0 ? undefined : (
            <PlayButton
              label={
                resume === undefined
                  ? t('item.play')
                  : t('item.resumeAt', { time: formatClock(resume) })
              }
              size={regular ? 'large' : 'block'}
            />
          )
        }
        progress={
          resume === undefined || progress === undefined ? undefined : (
            <ProgressLine
              ratio={progress.positionMs / Math.max(1, progress.durationMs)}
              remaining={t('item.remaining', {
                duration: formatRemaining(progress.durationMs - progress.positionMs, locale),
              })}
            />
          )
        }
        regular={regular}
      />
      <Tracks gutter={gutter} item={item} />
      <CastRow gutter={gutter} item={item} />
    </>
  )
}

type Layout = { regular: boolean; gutter: number }

/**
 * A title page (§13.5), pushed in the current tab under a transparent native header: a movie, a
 * series or an episode; a season opens its series on that season.
 */
export const ItemScreen = ({ id, season }: { id: string; season?: number | undefined }) => {
  const layout = useScreenLayout()
  const { height } = useWindowDimensions()
  const insets = useSafeAreaInsets()
  const item = useQuery(useCatalogQueries().item(id))
  const { regular, gutter } = layout

  const body = () => {
    if (item.isError)
      return (
        <View style={[styles.error, { minHeight: height * 0.8 }]}>
          <ErrorState error={item.error} onRetry={() => void item.refetch()} />
        </View>
      )
    if (item.isPending)
      return (
        <View aria-busy style={styles.skeleton}>
          <Skeleton height={regular ? 520 : (layout.width * 10) / 16} radius={0} />
          <View style={[styles.skeletonText, { paddingHorizontal: gutter }]}>
            <Skeleton height={34} width="70%" radius={8} />
            <Skeleton height={16} width="50%" radius={6} />
            <Skeleton height={46} radius={14} />
          </View>
        </View>
      )
    const data = item.data
    switch (data.kind) {
      case 'series':
        return <SeriesEpisodes gutter={gutter} regular={regular} season={season} series={data} />
      case 'season':
        return data.series === undefined ? undefined : (
          <Redirect
            href={{
              pathname: '/items/[id]',
              params: {
                id: data.series.id,
                ...(data.seasonNumber === undefined ? {} : { season: String(data.seasonNumber) }),
              },
            }}
          />
        )
      default:
        return <PlayableDetail gutter={gutter} item={data} regular={regular} />
    }
  }

  return (
    <View onLayout={layout.onLayout} style={styles.root}>
      {/* react-native-screens turns the first scroll view of a tab to automatic insets: the
          backdrop must run under the transparent header, so this one is not the first. */}
      <View collapsable={false} />
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 96 }]}
        contentInsetAdjustmentBehavior="never"
      >
        {body()}
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { gap: 32 },
  error: { justifyContent: 'center' },
  skeleton: { gap: 16 },
  skeletonText: { gap: 12 },
})
