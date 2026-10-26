import { useQuery } from '@tanstack/react-query'
import { SymbolView } from 'expo-symbols'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ActionSheetIOS, Pressable, StyleSheet, Text, View } from 'react-native'

import { formatDuration } from '@projo/i18n/format'
import { itemTitle, listedNumber, seasonLabel } from '@projo/i18n/item-titles'
import { durationMsOf, progressRatioOf, remainingMsOf } from '@projo/i18n/media'
import type { ItemDetailDto, ItemSummaryDto } from '@projo/shared/api/catalog'
import { episodeCards, episodeNumberLabel, sortedSeasons } from '@projo/shared/api/next-episode'

import { colors, fonts, radii } from '../../shared/styles/tokens.ts'
import { Button } from '../../shared/ui/Button.tsx'
import { Segmented } from '../../shared/ui/Choices.tsx'
import { EmptyState, ErrorState, Skeleton } from '../../shared/ui/states.tsx'
import { useWatchedToggle, useWatchlistToggle } from '../catalog/actions.ts'
import { useCatalogQueries } from '../catalog/queries.ts'
import { Artwork } from '../media/Artwork.tsx'
import { PlayButton } from '../media/buttons.tsx'
import { formatRemaining, playLabelOf, useLocale } from '../media/card-text.ts'
import { ProgressBar } from '../media/parts.tsx'
import { DetailHead, HeadAction, ProgressLine } from './DetailHead.tsx'
import { CastRow, Section } from './sections.tsx'

/**
 * The season tab: the asked one (`season`, else the season of the episode to play), else the
 * first regular season, else the specials (the web's `selectedSeasonOf`).
 */
const selectedSeasonOf = (seasons: readonly ItemSummaryDto[], wanted: number | undefined) =>
  seasons.find((item) => item.seasonNumber === wanted) ??
  seasons.find((item) => (item.seasonNumber ?? 0) > 0) ??
  seasons[0]

/**
 * One episode (artboard `MobileSeries`): its still with the play ring and its progress, "4. Title",
 * its running time or "In progress · 18 min left", the overview, and the "Watched" toggle.
 */
const EpisodeRow = ({
  episode,
  fallbackArt,
  regular,
}: {
  episode: ItemSummaryDto
  fallbackArt: string | undefined
  regular: boolean
}) => {
  const { t } = useTranslation()
  const locale = useLocale()
  const watched = useWatchedToggle()
  const seen = watched.watched(episode)
  const ratio = progressRatioOf(episode)
  const remaining = remainingMsOf(episode)
  const durationMs = durationMsOf(episode)
  const title = itemTitle(t, episode)
  const number = listedNumber(episode, episodeNumberLabel(episode))
  const meta =
    ratio !== undefined && remaining !== undefined
      ? t('item.inProgressRemaining', { duration: formatRemaining(remaining, locale) })
      : durationMs === undefined
        ? undefined
        : formatDuration(durationMs, locale)
  const overview =
    episode.overview === undefined ? undefined : (
      <Text numberOfLines={regular ? 3 : 4} style={styles.overview}>
        {episode.overview}
      </Text>
    )
  return (
    <View style={styles.episode}>
      <View style={styles.episodeHead}>
        <View style={[styles.still, regular && styles.stillLarge]}>
          <Artwork
            path={episode.images.still ?? fallbackArt}
            style={StyleSheet.absoluteFill}
            toneId={episode.id}
          />
          <View style={styles.ring}>
            <SymbolView name="play.fill" size={11} tintColor="#ffffff" />
          </View>
          {ratio !== undefined || seen ? (
            <ProgressBar
              ratio={ratio ?? 1}
              style={styles.stillBar}
              track="rgba(255, 255, 255, 0.18)"
            />
          ) : undefined}
        </View>
        <View style={styles.episodeText}>
          <Text numberOfLines={2} style={styles.episodeTitle}>
            {number === undefined ? title : `${number}. ${title}`}
          </Text>
          {meta === undefined ? undefined : <Text style={styles.episodeMeta}>{meta}</Text>}
          {regular ? overview : undefined}
        </View>
        <Pressable
          accessibilityLabel={
            seen
              ? t('item.markEpisodeUnwatched', { title })
              : t('item.markEpisodeWatched', { title })
          }
          accessibilityRole="button"
          accessibilityState={{ selected: seen }}
          hitSlop={8}
          onPress={() => watched.set(episode.id, !seen)}
          style={({ pressed }) => [styles.check, pressed && styles.pressed]}
        >
          <SymbolView
            name={seen ? 'checkmark.circle.fill' : 'checkmark.circle'}
            size={24}
            tintColor={seen ? colors.text : colors.textMuted}
          />
        </Pressable>
      </View>
      {regular ? undefined : overview}
    </View>
  )
}

/**
 * Series page (§13.5, artboards `MobileSeries`, `Series`): "Resume S2 · E4" (or "Play"), My list;
 * then the season tabs, "x of n watched", "12 / 22 episodes" when files are missing, "Mark all as
 * watched" and the bulk actions, the episodes; the cast last.
 */
export const SeriesEpisodes = ({
  series,
  season,
  regular,
  gutter,
}: {
  series: ItemDetailDto
  season: number | undefined
  regular: boolean
  gutter: number
}) => {
  const { t } = useTranslation()
  const locale = useLocale()
  const queries = useCatalogQueries()
  const watchlist = useWatchlistToggle()
  const watched = useWatchedToggle()
  const [chosen, setChosen] = useState(season)
  const seasons = useQuery(queries.children(series.id))
  const seasonItems = sortedSeasons(seasons.data?.items ?? [])
  const play = series.play
  const selected = selectedSeasonOf(seasonItems, chosen ?? play?.seasonNumber)
  const episodes = useQuery({
    ...queries.children(selected?.id ?? ''),
    enabled: selected !== undefined,
  })
  const episodeItems = episodeCards(episodes.data?.items ?? [])
  const playing = episodeItems.find((item) => item.id === play?.itemId)
  const playingRatio = playing === undefined ? undefined : progressRatioOf(playing)
  const playingRemaining = playing === undefined ? undefined : remainingMsOf(playing)
  const listed = watchlist.listed(series)
  const status = selected?.watchStatus
  const seasonWatched = status?.state === 'watched'
  const available = status?.totalCount ?? episodeItems.length
  const known = selected?.episodeCountTmdb
  const labelOf = (item: ItemSummaryDto) =>
    item.seasonNumber === undefined ? itemTitle(t, item) : seasonLabel(t, item.seasonNumber)

  const bulk = (current: ItemSummaryDto) => {
    const actions = [
      { label: t('item.bulk.seasonUnwatched'), run: () => watched.set(current.id, false) },
      { label: t('item.bulk.seriesWatched'), run: () => watched.set(series.id, true) },
      { label: t('item.bulk.seriesUnwatched'), run: () => watched.set(series.id, false) },
    ]
    ActionSheetIOS.showActionSheetWithOptions(
      {
        options: [...actions.map((action) => action.label), t('common.cancel')],
        cancelButtonIndex: actions.length,
      },
      (index) => actions[index]?.run(),
    )
  }

  const list = () => {
    if (seasons.isError)
      return <ErrorState error={seasons.error} onRetry={() => void seasons.refetch()} />
    if (seasons.isSuccess && seasonItems.length === 0)
      return <EmptyState title={t('item.noEpisodes')} />
    if (episodes.isError)
      return <ErrorState error={episodes.error} onRetry={() => void episodes.refetch()} />
    if (selected === undefined || episodes.isPending)
      return (
        <View aria-busy style={styles.episodes}>
          {[0, 1, 2, 3].map((index) => (
            <Skeleton key={index} height={regular ? 124 : 72} radius={radii.thumb} />
          ))}
        </View>
      )
    return (
      <View style={styles.episodes}>
        {episodeItems.map((episode) => (
          <EpisodeRow
            key={episode.id}
            episode={episode}
            fallbackArt={series.images.backdrop}
            regular={regular}
          />
        ))}
      </View>
    )
  }

  return (
    <>
      <DetailHead
        actions={
          <HeadAction
            icon={listed ? 'checkmark' : 'plus'}
            label={t('card.myList')}
            onPress={() => watchlist.toggle(series, !listed)}
            regular={regular}
            selected={listed}
          />
        }
        backdrop={series.images.backdrop}
        extra={
          series.seasonCount === undefined || series.seasonCount === 0
            ? undefined
            : t('item.seasonCount', { count: series.seasonCount })
        }
        item={series}
        play={
          play === undefined ? undefined : (
            <PlayButton label={playLabelOf(t, series, play)} size={regular ? 'large' : 'block'} />
          )
        }
        progress={
          playingRatio === undefined || playingRemaining === undefined ? undefined : (
            <ProgressLine
              ratio={playingRatio}
              remaining={t('item.remaining', {
                duration: formatRemaining(playingRemaining, locale),
              })}
            />
          )
        }
        regular={regular}
      />
      <View style={[styles.divider, { marginHorizontal: gutter }]} />
      <Section gutter={gutter} title={t('item.episodes')}>
        <View style={[styles.body, { paddingHorizontal: gutter }]}>
          {seasonItems.length > 0 ? (
            <Segmented
              choices={seasonItems.map((item) => ({ value: item.id, label: labelOf(item) }))}
              label={t('item.seasons')}
              onChange={(id) => setChosen(seasonItems.find((item) => item.id === id)?.seasonNumber)}
              role="tab"
              value={selected?.id}
            />
          ) : seasons.isPending ? (
            <Skeleton height={42} radius={radii.pill} width={200} />
          ) : undefined}
          {selected === undefined ? undefined : (
            <View style={styles.summary}>
              <Text style={styles.summaryText}>
                {[
                  status === undefined
                    ? undefined
                    : t('item.watchedOf', {
                        watched: status.watchedCount,
                        total: status.totalCount,
                      }),
                  known !== undefined && known > available
                    ? t('item.episodesOf', { available, total: known })
                    : undefined,
                ]
                  .filter((part) => part !== undefined)
                  .join(' · ')}
              </Text>
              <View style={styles.summaryActions}>
                <Button
                  label={
                    seasonWatched ? t('item.markSeasonUnwatched') : t('item.markSeasonWatched')
                  }
                  onPress={() => watched.set(selected.id, !seasonWatched)}
                  size="small"
                  variant="secondary"
                />
                <Pressable
                  accessibilityLabel={t('item.bulk.more')}
                  accessibilityRole="button"
                  hitSlop={6}
                  onPress={() => bulk(selected)}
                  style={({ pressed }) => [styles.more, pressed && styles.pressed]}
                >
                  <SymbolView name="ellipsis" size={18} tintColor={colors.text} />
                </Pressable>
              </View>
            </View>
          )}
          {list()}
        </View>
      </Section>
      <CastRow gutter={gutter} item={series} />
    </>
  )
}

const styles = StyleSheet.create({
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: 'rgba(255, 255, 255, 0.06)' },
  body: { gap: 16 },
  summary: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  summaryText: { color: colors.textMuted, fontFamily: fonts.regular, fontSize: 13 },
  summaryActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  more: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.glassButton,
  },
  pressed: { opacity: 0.6 },
  episodes: { gap: 18 },
  episode: { gap: 8 },
  episodeHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  still: { width: 128, aspectRatio: 16 / 9, borderRadius: radii.thumb, overflow: 'hidden' },
  stillLarge: { width: 220 },
  ring: {
    position: 'absolute',
    left: '50%',
    top: '50%',
    marginLeft: -15,
    marginTop: -15,
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.85)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stillBar: { position: 'absolute', left: 0, right: 0, bottom: 0, borderRadius: 0 },
  episodeText: { flex: 1, gap: 4 },
  episodeTitle: { color: colors.text, fontFamily: fonts.semibold, fontSize: 14 },
  episodeMeta: { color: colors.textMuted, fontFamily: fonts.regular, fontSize: 12 },
  overview: {
    color: colors.textSecondary,
    fontFamily: fonts.regular,
    fontSize: 13,
    lineHeight: 19,
  },
  check: { padding: 4 },
})
