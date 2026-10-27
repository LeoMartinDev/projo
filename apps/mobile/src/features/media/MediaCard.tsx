import { useTranslation } from 'react-i18next'
import { Pressable, StyleSheet, Text, View } from 'react-native'

import { posterOf, progressRatioOf, wideArtOf } from '@projo/i18n/media'
import type { ItemSummaryDto } from '@projo/shared/api/catalog'
import type { ResumeFrameDto } from '@projo/shared/api/home'

import { colors, fonts, radii } from '../../shared/styles/tokens.ts'
import { Artwork } from './Artwork.tsx'
import { type CardPlace, isPosterPlace, useCardText } from './card-text.ts'
import { ProgressBar } from './parts.tsx'

/**
 * A card of a home row (§13.3, artboard `MobileHome`): 16:9 with a still or a backdrop (Continue
 * watching, Up next, My list) or a 2:3 poster (Recently added, categories), the title on the
 * picture, a progress bar, the "New episode" badge. A tap opens the title page, a long press the
 * sheet of its actions.
 */
export const MediaCard = ({
  item,
  place,
  width,
  isNew = false,
  resumeFrame,
  onPress,
  onLongPress,
}: {
  item: ItemSummaryDto
  place: CardPlace
  width: number
  isNew?: boolean
  resumeFrame?: ResumeFrameDto | undefined
  onPress: () => void
  onLongPress: () => void
}) => {
  const { t } = useTranslation()
  const text = useCardText()(item, place)
  const poster = isPosterPlace(place)
  const ratio = progressRatioOf(item)
  return (
    <Pressable
      accessibilityHint={t('mobile.browse.longPressHint')}
      accessibilityLabel={[text.title, poster ? undefined : text.sub].filter(Boolean).join(', ')}
      accessibilityRole="button"
      delayLongPress={350}
      onLongPress={onLongPress}
      onPress={onPress}
      style={({ pressed }) => [{ width }, styles.card, pressed && styles.pressed]}
    >
      <Artwork
        path={poster ? posterOf(item) : wideArtOf(item)}
        style={[styles.art, poster ? styles.poster : styles.wide]}
        toneId={item.id}
      />
      {resumeFrame === undefined ? undefined : (
        // The frame it stopped at (§10.5), over the metadata picture until it loads.
        <Artwork
          path={resumeFrame.url}
          style={[styles.art, styles.wide, styles.overlay]}
          tinted={false}
          toneId={item.id}
        />
      )}
      <View style={[styles.art, poster ? styles.poster : styles.wide, styles.overlay]}>
        <View style={[StyleSheet.absoluteFill, poster ? styles.posterShade : styles.wideShade]} />
        {isNew ? (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{t('card.newEpisode')}</Text>
          </View>
        ) : undefined}
        <Text
          numberOfLines={2}
          style={[styles.title, poster ? styles.posterTitle : styles.wideTitle]}
        >
          {text.title}
        </Text>
        {ratio === undefined ? undefined : <ProgressBar ratio={ratio} style={styles.progress} />}
      </View>
      {poster ? undefined : (
        <View style={styles.caption}>
          <Text numberOfLines={1} style={styles.sub}>
            {text.sub}
          </Text>
          {text.right === undefined ? undefined : (
            <Text numberOfLines={1} style={styles.right}>
              {text.right}
            </Text>
          )}
        </View>
      )}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  card: { gap: 8 },
  pressed: { transform: [{ scale: 0.95 }] },
  art: { borderRadius: radii.card, overflow: 'hidden' },
  wide: { aspectRatio: 16 / 9 },
  poster: { aspectRatio: 2 / 3 },
  overlay: { position: 'absolute', top: 0, left: 0, right: 0 },
  wideShade: {
    backgroundImage: 'linear-gradient(0deg, rgba(0, 0, 0, 0.6) 0%, rgba(0, 0, 0, 0) 55%)',
  },
  posterShade: {
    backgroundImage: 'linear-gradient(0deg, rgba(0, 0, 0, 0.7) 0%, rgba(0, 0, 0, 0) 50%)',
  },
  title: { position: 'absolute', color: colors.text, fontFamily: fonts.bold },
  wideTitle: {
    left: 10,
    right: 10,
    bottom: 12,
    fontSize: 16,
    lineHeight: 17,
    letterSpacing: 16 * -0.03,
  },
  posterTitle: {
    left: 8,
    right: 8,
    bottom: 10,
    fontSize: 14,
    lineHeight: 14.5,
    letterSpacing: 14 * -0.02,
  },
  progress: { position: 'absolute', left: 10, right: 10, bottom: 5 },
  badge: {
    position: 'absolute',
    top: 8,
    left: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radii.pill,
    backgroundColor: colors.accent,
  },
  badgeText: { color: colors.onAccent, fontFamily: fonts.semibold, fontSize: 11 },
  caption: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  sub: { flexShrink: 1, color: colors.textMutedStrong, fontFamily: fonts.regular, fontSize: 12 },
  right: { color: colors.textMuted, fontFamily: fonts.regular, fontSize: 12 },
})
