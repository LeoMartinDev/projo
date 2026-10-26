import { Stack } from 'expo-router'
import { useTranslation } from 'react-i18next'

import { colors, fonts } from '../../../shared/styles/tokens.ts'

/** The first screen of each tab (§26.5); title pages, category pages and the card sheet are pushed over it. */
export const unstable_settings = {
  home: { anchor: 'index' },
  shows: { anchor: 'shows' },
  movies: { anchor: 'movies' },
  list: { anchor: 'list' },
  search: { anchor: 'search' },
}

const roots = {
  '(home)': { name: 'index', title: 'nav.home' },
  '(shows)': { name: 'shows', title: 'nav.series' },
  '(movies)': { name: 'movies', title: 'nav.movies' },
  '(list)': { name: 'list', title: 'nav.watchlist' },
  '(search)': { name: 'search', title: 'nav.search' },
} as const

const isTab = (segment: string): segment is keyof typeof roots => segment in roots

/**
 * The stack of a tab (`segment`: which one): native transitions and back swipe, large titles
 * (§26.5).
 */
const TabStack = ({ segment }: { segment: string }) => {
  const { t } = useTranslation()
  const root = roots[isTab(segment) ? segment : '(home)']
  const large = {
    headerShown: true,
    headerLargeTitle: true,
    headerTransparent: true,
    headerTintColor: colors.text,
    headerTitleStyle: { fontFamily: fonts.semibold, color: colors.text },
    headerLargeTitleStyle: { fontFamily: fonts.bold, color: colors.textStrong },
    headerBackTitleStyle: { fontFamily: fonts.regular },
    headerShadowVisible: false,
  } as const
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
      <Stack.Screen
        name={root.name}
        options={
          root.name === 'index' ? { title: t(root.title) } : { ...large, title: t(root.title) }
        }
      />
      <Stack.Screen name="categories/[category]" options={large} />
      <Stack.Screen
        name="items/[id]"
        options={{
          headerShown: true,
          headerTransparent: true,
          headerTitle: '',
          headerTintColor: colors.text,
          headerBackButtonDisplayMode: 'minimal',
        }}
      />
      <Stack.Screen
        name="card"
        options={{
          presentation: 'formSheet',
          sheetAllowedDetents: 'fitToContents',
          sheetGrabberVisible: true,
          sheetCornerRadius: 28,
          contentStyle: { backgroundColor: '#1c1c1f' },
        }}
      />
    </Stack>
  )
}

export default TabStack
