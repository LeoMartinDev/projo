import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'

import { colors, fonts } from '../../shared/styles/tokens.ts'
import { Skeleton } from '../../shared/ui/states.tsx'

/**
 * A home row (§13.3, artboard `MobileHome`): its title, "See all ›" when it has a page, and its
 * cards scrolled sideways.
 */
export const Row = ({
  title,
  gutter,
  gap,
  onSeeAll,
  children,
}: {
  title: string
  gutter: number
  gap: number
  onSeeAll?: (() => void) | undefined
  children: ReactNode
}) => {
  const { t } = useTranslation()
  return (
    <View style={styles.row}>
      <View style={[styles.head, { paddingHorizontal: gutter }]}>
        <Text accessibilityRole="header" numberOfLines={1} style={styles.title}>
          {title}
        </Text>
        {onSeeAll === undefined ? undefined : (
          <Pressable
            accessibilityLabel={`${t('home.seeAll')} ${title}`}
            accessibilityRole="link"
            hitSlop={10}
            onPress={onSeeAll}
            style={({ pressed }) => pressed && styles.pressed}
          >
            <Text style={styles.seeAll}>{t('home.seeAll')}</Text>
          </Pressable>
        )}
      </View>
      <ScrollView
        contentContainerStyle={{ gap, paddingHorizontal: gutter }}
        horizontal
        showsHorizontalScrollIndicator={false}
      >
        {children}
      </ScrollView>
    </View>
  )
}

/** A row while it loads: the same boxes as its cards, so nothing moves after (AGENTS.md). */
export const RowSkeleton = ({
  gutter,
  gap,
  width,
  poster,
}: {
  gutter: number
  gap: number
  width: number
  poster: boolean
}) => (
  <View style={styles.row}>
    <Skeleton height={20} radius={6} style={{ marginHorizontal: gutter }} width={160} />
    <View style={[styles.skeletons, { gap, paddingHorizontal: gutter }]}>
      {[0, 1, 2, 3, 4, 5].map((index) => (
        <Skeleton key={index} style={{ width, aspectRatio: poster ? 2 / 3 : 16 / 9 }} />
      ))}
    </View>
  </View>
)

const styles = StyleSheet.create({
  row: { gap: 12 },
  head: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 },
  title: {
    flexShrink: 1,
    color: colors.text,
    fontFamily: fonts.semibold,
    fontSize: 17,
    letterSpacing: 17 * -0.01,
  },
  seeAll: { color: colors.textSecondary, fontFamily: fonts.medium, fontSize: 14 },
  pressed: { opacity: 0.6 },
  skeletons: { flexDirection: 'row', overflow: 'hidden' },
})
