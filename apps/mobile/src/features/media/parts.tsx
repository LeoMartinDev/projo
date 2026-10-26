import type { ReactNode } from 'react'
import { StyleSheet, Text, View, type ViewStyle } from 'react-native'

import type { RatingBadge } from '@projo/i18n/content-ratings'

import { colors, fonts, radii } from '../../shared/styles/tokens.ts'

/** The kit's progress bar (`.bar`): a track and the accent up to `ratio` (0..1). */
export const ProgressBar = ({
  ratio,
  height = 3,
  style,
  track = 'rgba(255, 255, 255, 0.14)',
}: {
  ratio: number
  height?: number
  style?: ViewStyle
  track?: string
}) => (
  <View
    accessibilityElementsHidden
    importantForAccessibility="no-hide-descendants"
    style={[styles.track, { height, backgroundColor: track }, style]}
  >
    <View style={[styles.value, { width: `${Math.round(ratio * 1000) / 10}%` }]} />
  </View>
)

/** An outlined badge: the rating (§13.5, its full label for VoiceOver) or the quality ("4K HDR"). */
export const OutlineBadge = ({ text, label }: { text: string; label?: string }) => (
  <View accessibilityLabel={label ?? text} accessible style={styles.badge}>
    <Text style={styles.badgeText}>{text}</Text>
  </View>
)

/**
 * A metadata line (artboard `MobileSeries`): its parts separated by "·", the rating and the
 * quality as outlined badges.
 */
export const MetaLine = ({
  parts,
  rating,
  quality,
  center = false,
}: {
  parts: readonly (string | undefined)[]
  rating?: RatingBadge | undefined
  quality?: string | undefined
  center?: boolean
}) => {
  const items: ReactNode[] = [
    ...(rating === undefined
      ? []
      : [<OutlineBadge key="rating" label={rating.label} text={rating.text} />]),
    ...parts
      .filter((part) => part !== undefined && part !== '')
      .map((part) => (
        <Text key={part} style={styles.metaText}>
          {part}
        </Text>
      )),
    ...(quality === undefined ? [] : [<OutlineBadge key="quality" text={quality} />]),
  ]
  return (
    <View style={[styles.meta, center && styles.center]}>
      {items.flatMap((item, index) =>
        index === 0
          ? [item]
          : [
              <Text key={`dot-${index}`} aria-hidden style={styles.metaText}>
                ·
              </Text>,
              item,
            ],
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  track: { borderRadius: radii.pill, overflow: 'hidden' },
  value: { height: '100%', borderRadius: radii.pill, backgroundColor: colors.accent },
  badge: {
    paddingHorizontal: 5,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radii.badge,
  },
  badgeText: {
    color: colors.textSecondary,
    fontFamily: fonts.medium,
    fontSize: 11,
    lineHeight: 16,
  },
  meta: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 8, rowGap: 4 },
  center: { justifyContent: 'center' },
  metaText: { color: colors.textSecondary, fontFamily: fonts.regular, fontSize: 13 },
})
