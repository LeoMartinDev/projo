import { SymbolView } from 'expo-symbols'
import { useTranslation } from 'react-i18next'
import { Pressable, StyleSheet, Text, View } from 'react-native'

import { itemTitle } from '@projo/i18n/item-titles'
import { isWatched, partialCountOf, posterOf, progressRatioOf, yearsLabel } from '@projo/i18n/media'
import type { ItemSummaryDto } from '@projo/shared/api/catalog'

import { colors, fonts, radii } from '../../shared/styles/tokens.ts'
import { Artwork } from './Artwork.tsx'
import { ProgressBar } from './parts.tsx'

/**
 * A 2:3 tile of Movies, Shows, My list and the category pages (§13.4, the web's `PosterTile`):
 * without a poster (no TMDB match yet) the title and the year on the item's tone. A tick on what
 * is watched, a bar on what is in progress.
 */
export const PosterTile = ({
  item,
  width,
  onPress,
  onLongPress,
}: {
  item: ItemSummaryDto
  width: number
  onPress: () => void
  onLongPress: () => void
}) => {
  const { t } = useTranslation()
  const ratio = progressRatioOf(item)
  const partial = partialCountOf(item)
  const watched = isWatched(item)
  const title = itemTitle(t, item)
  const years = yearsLabel(item)
  return (
    <Pressable
      accessibilityHint={t('mobile.browse.longPressHint')}
      accessibilityLabel={[title, years, watched ? t('catalog.watched') : undefined]
        .filter(Boolean)
        .join(', ')}
      accessibilityRole="button"
      delayLongPress={350}
      onLongPress={onLongPress}
      onPress={onPress}
      style={({ pressed }) => [{ width }, styles.tile, pressed && styles.pressed]}
    >
      <Artwork
        fallback={
          <View style={styles.caption}>
            <Text numberOfLines={3} style={styles.title}>
              {title}
            </Text>
            {years === undefined ? undefined : <Text style={styles.year}>{years}</Text>}
          </View>
        }
        path={posterOf(item)}
        style={StyleSheet.absoluteFill}
        toneId={item.id}
      />
      {watched ? (
        <View style={styles.watched}>
          <SymbolView name="checkmark" size={11} tintColor={colors.onAccent} weight="bold" />
        </View>
      ) : undefined}
      {ratio !== undefined || partial !== undefined ? (
        <ProgressBar
          ratio={ratio ?? (partial === undefined ? 0 : partial.watched / partial.total)}
          style={styles.progress}
          track="rgba(255, 255, 255, 0.2)"
        />
      ) : undefined}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  tile: { aspectRatio: 2 / 3, borderRadius: radii.thumb, overflow: 'hidden' },
  pressed: { transform: [{ scale: 0.96 }] },
  caption: { flex: 1, justifyContent: 'flex-end', gap: 4, padding: 10 },
  title: { color: colors.text, fontFamily: fonts.bold, fontSize: 14, lineHeight: 16 },
  year: { color: colors.textSecondary, fontFamily: fonts.regular, fontSize: 12 },
  watched: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accent,
  },
  progress: { position: 'absolute', left: 8, right: 8, bottom: 6 },
})
