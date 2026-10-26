import { useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { colors, sizes } from '../../shared/styles/tokens.ts'
import { Logo } from '../../shared/ui/EntryScreen.tsx'
import { textStyles } from '../../shared/ui/text.ts'
import { Avatar } from '../profiles/Avatar.tsx'
import { useSession } from '../session/Session.tsx'

/**
 * Placeholder until browsing (M6 slice 3). The avatar at the top (`MobileHome`) opens the profile
 * and device settings.
 */
export const HomeScreen = () => {
  const { t } = useTranslation()
  const router = useRouter()
  const { gate } = useSession()
  if (gate.kind !== 'ready') return undefined
  const { profile } = gate

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.header}>
        <Logo />
        <Pressable
          accessibilityLabel={t('shell.accountMenu', { name: profile.name })}
          accessibilityRole="button"
          hitSlop={6}
          onPress={() => router.push('/settings')}
          style={({ pressed }) => pressed && styles.pressed}
        >
          <Avatar color={profile.avatarColor} name={profile.name} size={34} />
        </Pressable>
      </View>
      <View style={styles.body}>
        <Text style={textStyles.title}>{profile.name}</Text>
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: sizes.gutter,
    paddingTop: 12,
  },
  pressed: { opacity: 0.6 },
  body: { flex: 1, alignItems: 'center', justifyContent: 'center' },
})
