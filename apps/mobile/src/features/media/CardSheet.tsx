import { useQueryClient } from '@tanstack/react-query'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { type SFSymbol, SymbolView } from 'expo-symbols'
import { useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { Pressable, StyleSheet, Text, View } from 'react-native'

import { listTargetOf, progressRatioOf, qualityLabel, wideArtOf } from '@projo/i18n/media'

import { colors, fonts, radii } from '../../shared/styles/tokens.ts'
import { useHideFromContinue, useWatchedToggle, useWatchlistToggle } from '../catalog/actions.ts'
import { Artwork } from './Artwork.tsx'
import { PlayButton } from './buttons.tsx'
import { type CardPlace, useCardText } from './card-text.ts'
import { findItem } from './find-item.ts'
import { itemHref } from './navigation.ts'
import { ProgressBar } from './parts.tsx'

const places: readonly CardPlace[] = [
  'continue_watching',
  'up_next',
  'recently_added',
  'watchlist',
  'category',
  'grid',
]

/** A tile of the sheet (artboard `MobileHome`): its icon over its label, white when on. */
const Tile = ({
  label,
  icon,
  on = false,
  onPress,
}: {
  label: string
  icon: SFSymbol
  on?: boolean
  onPress: () => void
}) => (
  <Pressable
    accessibilityLabel={label}
    accessibilityRole="button"
    accessibilityState={{ selected: on }}
    onPress={onPress}
    style={({ pressed }) => [styles.tile, on && styles.tileOn, pressed && styles.pressed]}
  >
    <SymbolView name={icon} size={22} tintColor={on ? colors.onAccent : colors.text} />
    <Text numberOfLines={1} style={[styles.tileLabel, on && styles.tileLabelOn]}>
      {label}
    </Text>
  </Pressable>
)

/**
 * The long press of a card (§13.3, §26.5, artboard `MobileHome`): a native sheet with the card's
 * head, its progress, "Play" (inert until playback, M6 slice 5), My list / Mark as watched / More
 * info, and "Remove" on Continue watching and Up next. It reads the item in the query the card
 * comes from, so a toggle shows its new state, and closes when the item leaves it.
 */
export const CardSheet = () => {
  const { t } = useTranslation()
  const router = useRouter()
  const queryClient = useQueryClient()
  const params = useLocalSearchParams<{ id: string; place: string; key: string }>()
  const place = places.find((known) => known === params.place) ?? 'grid'
  const queryKey: unknown = JSON.parse(params.key ?? '[]')
  const item = useSyncExternalStore(
    (notify) => queryClient.getQueryCache().subscribe(notify),
    () =>
      Array.isArray(queryKey) ? findItem(queryClient.getQueryData(queryKey), params.id) : undefined,
  )
  const textOf = useCardText()
  const watchlist = useWatchlistToggle()
  const watched = useWatchedToggle()
  const hide = useHideFromContinue()
  if (item === undefined) return undefined

  const text = textOf(item, place)
  const ratio = progressRatioOf(item)
  const listTarget = listTargetOf(item)
  const listed = listTarget === undefined ? false : watchlist.listed(listTarget)
  const seen = watched.watched(item)
  const removable = place === 'continue_watching' || place === 'up_next'
  const meta = [text.rating?.text, text.duration, qualityLabel(item.bestQuality)].filter(
    (part) => part !== undefined,
  )

  return (
    <View style={styles.sheet}>
      <View style={styles.head}>
        <Artwork path={wideArtOf(item)} style={styles.art} toneId={item.id} />
        <View style={styles.who}>
          <Text accessibilityRole="header" numberOfLines={2} style={styles.title}>
            {text.title}
          </Text>
          <Text numberOfLines={2} style={styles.line}>
            {text.line}
          </Text>
          {meta.length === 0 ? undefined : (
            <Text
              accessibilityLabel={[text.rating?.label, ...meta.slice(text.rating ? 1 : 0)]
                .filter(Boolean)
                .join(', ')}
              style={styles.meta}
            >
              {meta.join(' · ')}
            </Text>
          )}
        </View>
        <Pressable
          accessibilityLabel={t('common.close')}
          accessibilityRole="button"
          hitSlop={8}
          onPress={() => router.back()}
          style={({ pressed }) => [styles.close, pressed && styles.pressed]}
        >
          <SymbolView name="xmark" size={13} tintColor={colors.textMutedStrong} weight="bold" />
        </Pressable>
      </View>

      {ratio === undefined ? undefined : (
        <View style={styles.progress}>
          <ProgressBar ratio={ratio} style={styles.bar} />
          {text.remaining === undefined ? undefined : (
            <Text style={styles.remaining}>{text.remaining}</Text>
          )}
        </View>
      )}

      <PlayButton label={ratio === undefined ? t('item.play') : t('card.resume')} size="block" />

      <View style={styles.tiles}>
        {listTarget === undefined ? undefined : (
          <Tile
            icon={listed ? 'checkmark' : 'plus'}
            label={t('card.myList')}
            on={false}
            onPress={() => watchlist.toggle(listTarget, !listed)}
          />
        )}
        <Tile
          icon="eye"
          label={seen ? t('catalog.watched') : t('card.markWatched')}
          on={seen}
          onPress={() => watched.set(item.id, !seen)}
        />
        <Tile
          icon="info.circle"
          label={t('card.info')}
          onPress={() => {
            router.back()
            router.push(itemHref(item))
          }}
        />
      </View>

      {removable ? (
        <Pressable
          accessibilityRole="button"
          disabled={hide.isPending}
          onPress={() => hide.mutate(item.id, { onSuccess: () => router.back() })}
          style={({ pressed }) => [styles.remove, pressed && styles.pressed]}
        >
          <SymbolView name="xmark" size={18} tintColor={colors.errorSoft} />
          <Text style={styles.removeLabel}>
            {place === 'continue_watching' ? t('card.removeContinue') : t('card.removeUpNext')}
          </Text>
        </Pressable>
      ) : undefined}
    </View>
  )
}

const styles = StyleSheet.create({
  sheet: { gap: 18, paddingHorizontal: 16, paddingTop: 24, paddingBottom: 28 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  art: { width: 120, aspectRatio: 16 / 9, borderRadius: radii.card },
  who: { flex: 1, gap: 4 },
  title: {
    color: colors.text,
    fontFamily: fonts.bold,
    fontSize: 18,
    lineHeight: 20,
    letterSpacing: 18 * -0.03,
  },
  line: { color: colors.textSecondary, fontFamily: fonts.regular, fontSize: 13 },
  meta: { color: colors.textMuted, fontFamily: fonts.regular, fontSize: 12 },
  close: {
    alignSelf: 'flex-start',
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
  },
  pressed: { opacity: 0.7, transform: [{ scale: 0.96 }] },
  progress: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  bar: { flex: 1 },
  remaining: { color: colors.textMuted, fontFamily: fonts.regular, fontSize: 12 },
  tiles: { flexDirection: 'row', gap: 8 },
  tile: {
    flex: 1,
    alignItems: 'center',
    gap: 8,
    paddingVertical: 14,
    paddingHorizontal: 4,
    borderRadius: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.07)',
  },
  tileOn: { backgroundColor: colors.accent },
  tileLabel: { color: colors.text, fontFamily: fonts.medium, fontSize: 12 },
  tileLabelOn: { color: colors.onAccent },
  remove: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    height: 50,
    paddingHorizontal: 16,
    borderRadius: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
  },
  removeLabel: { color: colors.errorSoft, fontFamily: fonts.regular, fontSize: 15 },
})
