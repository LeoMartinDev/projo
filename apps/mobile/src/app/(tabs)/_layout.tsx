import { NativeTabs } from 'expo-router/native-tabs'
import { useTranslation } from 'react-i18next'
import { StyleSheet, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { colors } from '../../shared/styles/tokens.ts'
import { OfflineBanner } from '../../shared/ui/states.tsx'

/**
 * Browsing (§26.5): on an iPhone the tab bar Home · Shows · Movies · My list · Search; on an iPad
 * the same entries in a sidebar, in the manner of the Apple TV app (the system's sidebar-adaptable
 * tab bar). Each tab keeps its own stack.
 */
const TabsLayout = () => {
  const { t } = useTranslation()
  return (
    <View style={styles.root}>
      <NativeTabs
        backgroundColor={colors.bg}
        iconColor={{ default: colors.textSecondary, selected: colors.text }}
        labelStyle={{ default: { color: colors.textSecondary }, selected: { color: colors.text } }}
        sidebarAdaptable
        tintColor={colors.text}
      >
        <NativeTabs.Trigger name="(home)">
          <NativeTabs.Trigger.Label>{t('nav.home')}</NativeTabs.Trigger.Label>
          <NativeTabs.Trigger.Icon sf={{ default: 'house', selected: 'house.fill' }} />
        </NativeTabs.Trigger>
        <NativeTabs.Trigger name="(shows)">
          <NativeTabs.Trigger.Label>{t('nav.series')}</NativeTabs.Trigger.Label>
          <NativeTabs.Trigger.Icon sf={{ default: 'tv', selected: 'tv.fill' }} />
        </NativeTabs.Trigger>
        <NativeTabs.Trigger name="(movies)">
          <NativeTabs.Trigger.Label>{t('nav.movies')}</NativeTabs.Trigger.Label>
          <NativeTabs.Trigger.Icon sf={{ default: 'film', selected: 'film.fill' }} />
        </NativeTabs.Trigger>
        <NativeTabs.Trigger name="(list)">
          <NativeTabs.Trigger.Label>{t('nav.watchlist')}</NativeTabs.Trigger.Label>
          <NativeTabs.Trigger.Icon sf={{ default: 'bookmark', selected: 'bookmark.fill' }} />
        </NativeTabs.Trigger>
        <NativeTabs.Trigger name="(search)" role="search">
          <NativeTabs.Trigger.Label>{t('nav.search')}</NativeTabs.Trigger.Label>
          <NativeTabs.Trigger.Icon sf="magnifyingglass" />
        </NativeTabs.Trigger>
      </NativeTabs>
      <SafeAreaView edges={['top']} pointerEvents="box-none" style={styles.banner}>
        <OfflineBanner />
      </SafeAreaView>
    </View>
  )
}

export default TabsLayout

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  banner: { position: 'absolute', top: 0, left: 0, right: 0 },
})
