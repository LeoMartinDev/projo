import { useTranslation } from 'react-i18next'
import { StyleSheet, Text, View } from 'react-native'

import { Button } from '../../shared/ui/Button.tsx'
import { Screen } from '../../shared/ui/Screen.tsx'
import { textStyles } from '../../shared/ui/text.ts'
import { Avatar } from '../profiles/Avatar.tsx'
import { useSession } from '../session/Session.tsx'

/** Placeholder until browsing (M6 slice 3): who is watching, switch profile, sign out. */
export const HomeScreen = () => {
  const { t } = useTranslation()
  const { gate, switchProfile, signOut, signingOut } = useSession()
  if (gate.kind !== 'ready') return undefined
  const { profile } = gate

  return (
    <Screen>
      <View style={styles.profile}>
        <Avatar color={profile.avatarColor} name={profile.name} size={72} />
        <Text accessibilityRole="header" style={textStyles.title}>
          {profile.name}
        </Text>
      </View>
      <Button label={t('shell.switchProfile')} onPress={switchProfile} variant="secondary" />
      <Button busy={signingOut} label={t('shell.logout')} onPress={signOut} variant="plain" />
    </Screen>
  )
}

const styles = StyleSheet.create({
  profile: { alignItems: 'center', gap: 16, paddingBottom: 16 },
})
