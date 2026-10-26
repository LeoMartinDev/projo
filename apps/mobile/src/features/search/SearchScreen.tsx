import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Stack } from 'expo-router'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'

import { itemTitle } from '@projo/i18n/item-titles'
import { posterOf, yearsLabel } from '@projo/i18n/media'
import type { ItemSummaryDto } from '@projo/shared/api/catalog'

import { colors, fonts, radii, sizes } from '../../shared/styles/tokens.ts'
import { ErrorState, Skeleton } from '../../shared/ui/states.tsx'
import { textStyles } from '../../shared/ui/text.ts'
import { useCatalogQueries } from '../catalog/queries.ts'
import { Artwork } from '../media/Artwork.tsx'
import { useOpenItem } from '../media/navigation.ts'

const debounceMs = 180

/** The query sent to the API, `debounceMs` after the last keystroke (§13.5 "instant"). */
const useDebounced = (value: string): string => {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), debounceMs)
    return () => clearTimeout(timer)
  }, [value])
  return debounced
}

const Result = ({ item }: { item: ItemSummaryDto }) => {
  const { t } = useTranslation()
  const openItem = useOpenItem()
  const title = itemTitle(t, item)
  const years = yearsLabel(item)
  return (
    <Pressable
      accessibilityLabel={[title, years].filter(Boolean).join(', ')}
      accessibilityRole="button"
      onPress={() => openItem(item)}
      style={({ pressed }) => [styles.result, pressed && styles.pressed]}
    >
      <Artwork path={posterOf(item)} style={styles.poster} toneId={item.id} />
      <View style={styles.resultText}>
        <Text numberOfLines={2} style={styles.title}>
          {title}
        </Text>
        {years === undefined ? undefined : <Text style={styles.year}>{years}</Text>}
      </View>
    </Pressable>
  )
}

/**
 * Search (§13.5): the native search field of the tab, instant results from 2 characters, movies
 * and shows apart; a result opens its title page in this tab.
 */
export const SearchScreen = () => {
  const { t } = useTranslation()
  const [text, setText] = useState('')
  const q = useDebounced(text.trim())
  const ready = q.length >= 2
  const search = useQuery({ ...useCatalogQueries().search(q), placeholderData: keepPreviousData })
  const data = ready ? search.data : undefined

  const group = (title: string, items: readonly ItemSummaryDto[]) =>
    items.length === 0 ? undefined : (
      <View style={styles.group}>
        <Text accessibilityRole="header" style={textStyles.section}>
          {title}
        </Text>
        {items.map((item) => (
          <Result key={item.id} item={item} />
        ))}
      </View>
    )

  const body = () => {
    if (!ready) return <Text style={[textStyles.body, styles.hint]}>{t('search.hint')}</Text>
    if (search.isError)
      return <ErrorState error={search.error} onRetry={() => void search.refetch()} />
    if (data === undefined)
      return (
        <View aria-busy style={styles.group}>
          {[0, 1, 2, 3].map((index) => (
            <Skeleton key={index} height={69} radius={radii.thumb} />
          ))}
        </View>
      )
    if (data.movies.length + data.series.length === 0)
      return (
        <Text accessibilityLiveRegion="polite" style={[textStyles.body, styles.hint]}>
          {t('search.empty', { query: q })}
        </Text>
      )
    return (
      <>
        {group(t('nav.movies'), data.movies)}
        {group(t('nav.series'), data.series)}
      </>
    )
  }

  return (
    <>
      <Stack.Screen
        options={{
          headerSearchBarOptions: {
            placeholder: t('search.placeholder'),
            autoCapitalize: 'none',
            hideWhenScrolling: false,
            onChangeText: (event) => setText(event.nativeEvent.text),
          },
        }}
      />
      <ScrollView
        contentContainerStyle={styles.content}
        contentInsetAdjustmentBehavior="automatic"
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        style={styles.root}
      >
        {body()}
      </ScrollView>
    </>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: {
    gap: 24,
    paddingHorizontal: sizes.gutter,
    paddingTop: 8,
    paddingBottom: 32,
    width: '100%',
    maxWidth: 720,
    alignSelf: 'center',
  },
  hint: { textAlign: 'center', paddingTop: 32 },
  group: { gap: 10 },
  result: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  pressed: { opacity: 0.6 },
  poster: { width: 46, aspectRatio: 2 / 3, borderRadius: 6 },
  resultText: { flex: 1, gap: 2 },
  title: { color: colors.text, fontFamily: fonts.semibold, fontSize: 16 },
  year: { color: colors.textMuted, fontFamily: fonts.regular, fontSize: 13 },
})
